import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  db,
  awardXp,
  getProgress,
  getProgressHud,
  levelInfo,
  XP_PER_CORRECT,
  DATA_DIR,
  getCourseRow,
} from "./store.ts";
import { extractDocument, isSupported, rejectReason, saveExtracted, chunkText } from "./extract.ts";
import { generateStudySet, getAiConfig, PROVIDER_PRESETS, chat } from "./ai.ts";
import { startCourseGeneration, courseStatus, sectionCheckpoint } from "./courses.ts";
import { COURSE_XP } from "./store.ts";

export type Api = {
  [route: string]: (req: Request, params: Record<string, string>) => Promise<unknown>;
};

function jsonId(): string {
  return crypto.randomUUID();
}

const ok = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

// --- GET routes -----------------------------------------------------------

export const apiGet: Api = {
  "progress": async () => {
    const p = getProgress();
    return { ...p, ...levelInfo(p.xp), xpPerCorrect: XP_PER_CORRECT };
  },

  "documents": async () => {
    const rows = db.prepare(
      `SELECT d.id, d.title, d.file_type, d.char_count, d.page_count, d.created_at,
              n.updated_at AS notes_at,
              (SELECT COUNT(*) FROM flashcards f WHERE f.document_id = d.id) AS flashcard_count,
              (SELECT COUNT(*) FROM quiz_questions q WHERE q.document_id = d.id) AS quiz_count,
              (SELECT COUNT(*) FROM flashcards f WHERE f.document_id = d.id AND f.due <= datetime('now')) AS due_count
       FROM documents d LEFT JOIN notes n ON n.document_id = d.id
       ORDER BY d.created_at DESC`,
    ).all();
    return { documents: rows };
  },

  "documents/:id": async (_req, params) => {
    const doc = db.prepare("SELECT id, title, file_type, char_count, page_count, created_at FROM documents WHERE id = ?")
      .get(params.id);
    if (!doc) throw new Error("Document not found.");
    const note = db.prepare("SELECT content, model, updated_at FROM notes WHERE document_id = ?").get(params.id);
    const flashcards = db.prepare(
      "SELECT id, front, back, ease, interval_days, reps, due FROM flashcards WHERE document_id = ? ORDER BY created_at",
    ).all(params.id);
    const quiz = db.prepare("SELECT id, question, options, correct_index, explanation FROM quiz_questions WHERE document_id = ? ORDER BY created_at")
      .all(params.id)
      .map((q) => {
        const r = q as { options: string };
        return { ...(q as object), options: JSON.parse(r.options) as string[] };
      });
    return { document: doc, notes: note ?? null, flashcards, quiz };
  },

  "courses/:id/status": async (_req, params) => {
    const st = courseStatus(params.id);
    if (!st) throw new Error("Course not found.");
    return st;
  },

  "courses/:id/sections/:sid/checkpoint": async (_req, params) => {
    return { checkpoint: sectionCheckpoint(params.sid) };
  },

  "courses/:id": async (_req, params) => {
    const course = getCourseRow(params.id);
    if (!course) throw new Error("Course not found.");
    const sections = db.prepare(
      "SELECT id, idx, title, summary, content, status, error, done, checkpoint_score, checkpoint_total FROM course_sections WHERE course_id = ? ORDER BY idx",
    ).all(params.id);
    const questions = db.prepare("SELECT id, kind, idx, question, options, correct_index, explanation FROM course_questions WHERE course_id = ? ORDER BY kind DESC, idx")
      .all(params.id)
      .map((q) => {
        const r = q as { options: string };
        return { ...(q as object), options: JSON.parse(r.options) as string[] };
      });
    return {
      course: {
        id: course.id,
        documentId: course.document_id,
        title: course.title,
        intro: course.intro,
        coverage: course.coverage ? JSON.parse(course.coverage as string) : [],
        goal: course.goal,
        familiarity: course.familiarity,
        status: course.status,
        error: course.error,
        warmupDone: !!course.warmup_done,
        finalDone: !!course.final_done,
        finalBest: course.final_best_score,
        finalTotal: course.final_total,
      },
      sections,
      questions,
    };
  },

  "ai/config": async () => {
    const cfg = getAiConfig();
    // never leak the raw key to the client; only show whether it's set
    return { ...cfg, apiKey: cfg.apiKey ? "••••••••" : "", hasKey: !!cfg.apiKey, presets: PROVIDER_PRESETS };
  },
};

// Additional POST routes appended after the main map (see bottom of file).

// --- POST routes ------------------------------------------------------------

export const apiPost: Api = {
  "test-ai": async () => {
    const reply = await chat(
      [{ role: "user", content: "Reply with exactly: StudyForge AI connected" }],
      { maxTokens: 400, temperature: 0 },
    );
    return { ok: true, reply: reply.trim().slice(0, 120) };
  },
  // --- upload + generate ----------------------------------------------------
  "documents/upload": async (req) => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file received.");

    const name = file.name || "untitled";
    const reason = rejectReason(name);
    if (reason) throw new Error(reason);

    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    const id = jsonId();
    const safeName = `${id}${ext}`;
    const filePath = join(DATA_DIR, safeName);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await Deno.writeFile(filePath, bytes);

    // Extract text
    const extraction = await extractDocument(filePath, ext);
    if (!extraction.ok) {
      await unlink(filePath).catch(() => {});
      throw new Error(extraction.error ?? "Extraction failed.");
    }
    const textPath = saveExtracted(id, extraction.text);
    db.prepare(
      "INSERT INTO documents (id, title, file_type, file_path, char_count, page_count) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, name.replace(/\.[^.]+$/, "") || name, ext, textPath, extraction.text.length, extraction.pages ?? null);

    // Generate study material (kept separate from extraction so a failed AI
    // call never loses the uploaded document — user can Regenerate later).
    let studySet: Awaited<ReturnType<typeof generateStudySet>> | null = null;
    let warning: string | null = null;
    const chunks = chunkText(extraction.text, 12000);
    try {
      studySet = await generateStudySet(
        name,
        chunks.length > 1
          ? chunks.map((c, i) => `Part ${i + 1}:\n${c}`).join("\n\n")
          : chunks[0],
      );
    } catch (e) {
      warning =
        `Document saved, but AI generation failed: ${(e as Error).message} ` +
        `Check AI Settings, then press "Regenerate with AI" on the document.`;
    }

    const tx = db; // node:sqlite is sync; wrap manually
    tx.exec("BEGIN");
    try {
      if (studySet?.notes) {
        tx.prepare("INSERT INTO notes (document_id, content, model) VALUES (?, ?, ?)").run(
          id,
          studySet.notes,
          getAiConfig().model,
        );
      }
      for (const c of studySet?.flashcards ?? []) {
        tx.prepare("INSERT INTO flashcards (id, document_id, front, back) VALUES (?, ?, ?, ?)").run(
          jsonId(), id, c.front, c.back,
        );
      }
      for (const q of studySet?.quiz ?? []) {
        tx.prepare(
          "INSERT INTO quiz_questions (id, document_id, question, options, correct_index, explanation) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(jsonId(), id, q.question, JSON.stringify(q.options), q.correctIndex, q.explanation ?? null);
      }
      tx.exec("COMMIT");
    } catch (e) {
      tx.exec("ROLLBACK");
      throw e;
    }

    const result: Record<string, unknown> = {
      documentId: id,
      notes: !!studySet?.notes,
      flashcards: studySet?.flashcards.length ?? 0,
      quiz: studySet?.quiz.length ?? 0,
    };
    if (warning) result.warning = warning;
    return result;
  },

  // --- regenerate study material -------------------------------------------
  "documents/:id/regenerate": async (_req, params) => {
    const doc = db.prepare("SELECT id, title, file_path FROM documents WHERE id = ?").get(params.id) as
      | { id: string; title: string; file_path: string }
      | undefined;
    if (!doc) throw new Error("Document not found.");
    const text = (await Deno.readTextFile(doc.file_path)).trim();
    if (!text) throw new Error("No extracted text stored for this document.");

    const chunks = chunkText(text, 12000);
    const studySet = await generateStudySet(
      doc.title,
      chunks.length > 1 ? chunks.map((c, i) => `Part ${i + 1}:\n${c}`).join("\n\n") : chunks[0],
    );

    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO notes (document_id, content, model) VALUES (?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET content = excluded.content, model = excluded.model, updated_at = datetime('now')",
      ).run(params.id, studySet.notes, getAiConfig().model);
      db.prepare("DELETE FROM flashcards WHERE document_id = ?").run(params.id);
      db.prepare("DELETE FROM quiz_questions WHERE document_id = ?").run(params.id);
      for (const c of studySet.flashcards) {
        db.prepare("INSERT INTO flashcards (id, document_id, front, back) VALUES (?, ?, ?, ?)").run(jsonId(), params.id, c.front, c.back);
      }
      for (const q of studySet.quiz) {
        db.prepare(
          "INSERT INTO quiz_questions (id, document_id, question, options, correct_index, explanation) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(jsonId(), params.id, q.question, JSON.stringify(q.options), q.correctIndex, q.explanation ?? null);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { ok: true, flashcards: studySet.flashcards.length, quiz: studySet.quiz.length };
  },

  "documents/:id/delete": async (_req, params) => {
    const doc = db.prepare("SELECT file_path FROM documents WHERE id = ?").get(params.id) as { file_path: string } | undefined;
    if (doc) await unlink(doc.file_path).catch(() => {});
    db.prepare("DELETE FROM documents WHERE id = ?").run(params.id);
    return { ok: true };
  },

  // --- flashcard review (SM-2 style) ----------------------------------------
  "review/:cardId": async (_req, params) => {
    const body = await _req.json() as { grade: "again" | "hard" | "good" | "easy" };
    const card = db.prepare("SELECT ease, interval_days, reps, lapses FROM flashcards WHERE id = ?").get(params.cardId) as
      | { ease: number; interval_days: number; reps: number; lapses: number }
      | undefined;
    if (!card) throw new Error("Card not found.");

    const ease = card.ease;
    const interval = card.interval_days;
    const reps = card.reps;

    let newEase = ease;
    let newInterval = interval;
    let xp = 0;

    if (body.grade === "again") {
      newEase = Math.max(1.3, ease - 0.2);
      newInterval = 0; // 10 minutes
      db.prepare("UPDATE flashcards SET ease = ?, interval_days = ?, reps = ?, lapses = lapses + 1, due = datetime('now', '+10 minutes') WHERE id = ?")
        .run(newEase, newInterval, reps + 1, params.cardId);
      xp = 2;
    } else {
      const mult = body.grade === "hard" ? 1.2 : body.grade === "good" ? ease : ease * 1.3;
      newInterval = reps === 0 ? (body.grade === "hard" ? 0.5 : 1) : Math.max(1, Math.round(interval * mult));
      newEase = Math.min(3.0, body.grade === "hard" ? Math.max(1.3, ease - 0.05) : body.grade === "good" ? ease : ease + 0.1);
      db.prepare(
        "UPDATE flashcards SET ease = ?, interval_days = ?, reps = reps + 1, due = datetime('now', ?) WHERE id = ?",
      ).run(newEase, newInterval, `+${Math.max(newInterval, 0.007)} days`, params.cardId);
      xp = body.grade === "hard" ? 6 : body.grade === "good" ? XP_PER_CORRECT : 12;
    }

    const progress = awardXp(xp);
    return { ok: true, xp: progress.xpGained, progress };
  },

  // --- courses -----------------------------------------------------------------
  "courses/create": async (req) => {
    const { documentId } = await req.json() as { documentId: string };
    const doc = db.prepare("SELECT id, title, file_path FROM documents WHERE id = ?").get(documentId) as
      | { id: string; title: string; file_path: string }
      | undefined;
    if (!doc) throw new Error("Document not found.");
    const text = (await Deno.readTextFile(doc.file_path)).trim();
    if (!text) throw new Error("Document has no extracted text.");

    const existing = db.prepare("SELECT id FROM courses WHERE document_id = ?").get(documentId) as { id: string } | undefined;
    if (existing) return { courseId: existing.id, existed: true };

    const id = jsonId();
    db.prepare("INSERT INTO courses (id, document_id, title, intro, status) VALUES (?, ?, ?, ?, 'generating')")
      .run(id, documentId, doc.title, "");
    startCourseGeneration(id, doc.title, text);
    return { courseId: id, existed: false };
  },

  "courses/:id/regenerate": async (_req, params) => {
    const course = getCourseRow(params.id);
    if (!course) throw new Error("Course not found.");
    const doc = db.prepare("SELECT id, title, file_path FROM documents WHERE id = ?").get(course.document_id as string) as
      | { id: string; title: string; file_path: string }
      | undefined;
    if (!doc) throw new Error("Source document missing.");
    const text = (await Deno.readTextFile(doc.file_path)).trim();
    db.prepare("UPDATE courses SET status = 'generating', error = NULL, warmup_done = 0, final_done = 0, final_best_score = NULL, final_total = NULL WHERE id = ?").run(params.id);
    startCourseGeneration(params.id, doc.title, text);
    return { ok: true };
  },

  "courses/:id/profile": async (req, params) => {
    const body = await req.json() as { goal?: string; familiarity?: string };
    if (body.goal) db.prepare("UPDATE courses SET goal = ? WHERE id = ?").run(body.goal, params.id);
    if (body.familiarity) db.prepare("UPDATE courses SET familiarity = ? WHERE id = ?").run(body.familiarity, params.id);
    return { ok: true };
  },

  "courses/:id/warmup-complete": async (req, params) => {
    const body = await req.json() as { answers: number[] };
    const course = getCourseRow(params.id);
    if (!course) throw new Error("Course not found.");
    const qs = db.prepare("SELECT id, correct_index FROM course_questions WHERE course_id = ? AND kind = 'warmup' ORDER BY idx")
      .all(params.id) as { id: string; correct_index: number }[];
    const results = qs.map((q, i) => ({ correct: body.answers[i] === q.correct_index, correctIndex: q.correct_index }));
    const score = results.filter((r) => r.correct).length;

    const already = !!course.warmup_done;
    db.prepare("UPDATE courses SET warmup_done = 1, warmup_answers = ? WHERE id = ?").run(JSON.stringify(body.answers), params.id);
    // no repeat rewards — but always return a full HUD payload
    const progress = already ? getProgressHud() : awardXp(COURSE_XP.warmup);
    return { score, total: qs.length, results, xpEarned: already ? 0 : COURSE_XP.warmup, progress };
  },

  "courses/:id/sections/:sid/complete": async (req, params) => {
    const body = await req.json() as { answers: number[] };
    const sec = db.prepare("SELECT id, done, checkpoint FROM course_sections WHERE id = ? AND course_id = ?").get(params.sid, params.id) as
      | { id: string; done: number; checkpoint: string | null }
      | undefined;
    if (!sec) throw new Error("Section not found.");
    const cp = sectionCheckpoint(params.sid);
    if (!cp.length) throw new Error("This section has no checkpoint yet.");

    const results = cp.map((q, i) => ({ correct: body.answers[i] === q.correctIndex, correctIndex: q.correctIndex }));
    const score = results.filter((r) => r.correct).length;
    const first = !sec.done;
    const perfect = score === cp.length;

    const xpEarned = (first ? COURSE_XP.section : 0) +
      score * COURSE_XP.checkpointCorrect +
      (perfect ? COURSE_XP.checkpointPerfect : 0);

    db.prepare("UPDATE course_sections SET done = 1, checkpoint_score = MAX(COALESCE(checkpoint_score, 0), ?), checkpoint_total = ? WHERE id = ?")
      .run(score, cp.length, params.sid);

    const progress = xpEarned > 0 ? awardXp(xpEarned) : getProgressHud();
    return { score, total: cp.length, results, xpEarned, first, progress };
  },

  "courses/:id/final-submit": async (req, params) => {
    const body = await req.json() as { answers: number[] };
    const course = getCourseRow(params.id);
    if (!course) throw new Error("Course not found.");
    const qs = db.prepare("SELECT id, correct_index FROM course_questions WHERE course_id = ? AND kind = 'final' ORDER BY idx")
      .all(params.id) as { id: string; correct_index: number }[];
    const results = qs.map((q, i) => ({ correct: body.answers[i] === q.correct_index, correctIndex: q.correct_index }));
    const score = results.filter((r) => r.correct).length;
    const perfect = score === qs.length;

    const xpEarned = score * COURSE_XP.finalCorrect + (perfect ? COURSE_XP.finalPerfect : 0);
    const best = Math.max(score, (course.final_best_score as number) ?? 0);
    db.prepare("UPDATE courses SET final_done = 1, final_best_score = ?, final_total = ? WHERE id = ?").run(best, qs.length, params.id);

    const progress = awardXp(xpEarned);
    db.prepare("INSERT INTO attempts (id, document_id, kind, score, total, xp_earned) VALUES (?, ?, 'course_final', ?, ?, ?)")
      .run(jsonId(), course.document_id as string, score, qs.length, xpEarned);

    return { score, total: qs.length, results, xpEarned, perfect, progress };
  },

  // --- quiz submission --------------------------------------------------------
  "quiz/:docId/submit": async (req, params) => {
    const body = await req.json() as { answers: number[] };
    const rows = db.prepare("SELECT id, correct_index FROM quiz_questions WHERE document_id = ? ORDER BY created_at")
      .all(params.docId) as { id: string; correct_index: number }[];
    if (rows.length === 0) throw new Error("No quiz found for this document.");

    const results = rows.map((r, i) => ({
      questionId: r.id,
      correct: body.answers[i] === r.correct_index,
      correctIndex: r.correct_index,
    }));
    const score = results.filter((r) => r.correct).length;

    const xpEarned = score * XP_PER_CORRECT + (score === rows.length ? 25 : 0);
    const progress = awardXp(xpEarned);

    db.prepare("INSERT INTO attempts (id, document_id, kind, score, total, xp_earned) VALUES (?, ?, 'quiz', ?, ?, ?)")
      .run(jsonId(), params.docId, score, rows.length, xpEarned);

    return { score, total: rows.length, results, xpEarned, progress };
  },
};


