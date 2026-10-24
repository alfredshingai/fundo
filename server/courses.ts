import { db, getCourseRow, awardSectionComplete, COURSE_XP } from "./store.ts";
import { generateCourseOutline, generateSection } from "./ai.ts";
import { chunkText } from "./extract.ts";

const running = new Set<string>();

export function courseStatus(courseId: string) {
  const course = getCourseRow(courseId);
  if (!course) return null;
  const sections = db.prepare(
    "SELECT id, idx, title, summary, status, error, done FROM course_sections WHERE course_id = ? ORDER BY idx",
  ).all(courseId);
  const done = (sections as { done: number }[]).filter((s) => s.done).length;
  return {
    course: { id: course.id, title: course.title, status: course.status, error: course.error },
    sections,
    sectionsDone: done,
    sectionsTotal: sections.length,
  };
}

/** Kick off course generation in the background. Returns immediately. */
export function startCourseGeneration(courseId: string, docTitle: string, docText: string): void {
  if (running.has(courseId)) return;
  running.add(courseId);

  (async () => {
    try {
      const chunks = chunkText(docText, 14000);
      const source = chunks.length > 1
        ? chunks.map((c, i) => `Part ${i + 1}:\n${c}`).join("\n\n")
        : chunks[0];

      // 1) Outline (title, intro, coverage, section plan, warmup + final)
      const outline = await generateCourseOutline(docTitle, source);
      db.prepare(
        "UPDATE courses SET title = ?, intro = ?, coverage = ?, status = 'writing_sections', error = NULL WHERE id = ?",
      ).run(outline.title, outline.intro, JSON.stringify(outline.coverage), courseId);

      db.prepare("DELETE FROM course_sections WHERE course_id = ?").run(courseId);
      db.prepare("DELETE FROM course_questions WHERE course_id = ?").run(courseId);
      for (const [i, s] of outline.sections.entries()) {
        db.prepare("INSERT INTO course_sections (id, course_id, idx, title, summary) VALUES (?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), courseId, i, s.title, s.summary);
      }
      for (const [i, q] of outline.warmup.entries()) {
        db.prepare("INSERT INTO course_questions (id, course_id, kind, idx, question, options, correct_index, explanation) VALUES (?, ?, 'warmup', ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), courseId, i, q.question, JSON.stringify(q.options), q.correctIndex, q.explanation ?? null);
      }
      for (const [i, q] of outline.final.entries()) {
        db.prepare("INSERT INTO course_questions (id, course_id, kind, idx, question, options, correct_index, explanation) VALUES (?, ?, 'final', ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), courseId, i, q.question, JSON.stringify(q.options), q.correctIndex, q.explanation ?? null);
      }

      // 2) Write sections one at a time so each builds on the last
      let prevTitle: string | undefined;
      for (const s of db.prepare("SELECT id, title, summary FROM course_sections WHERE course_id = ? ORDER BY idx").all(courseId) as { id: string; title: string; summary: string }[]) {
        try {
          const { content, checkpoint } = await generateSection(outline.title, s.title, s.summary, source, prevTitle);
          db.prepare("UPDATE course_sections SET content = ?, checkpoint = ?, status = 'ready', error = NULL WHERE id = ?")
            .run(content, JSON.stringify(checkpoint), s.id);
          prevTitle = s.title;
        } catch (e) {
          db.prepare("UPDATE course_sections SET status = 'error', error = ? WHERE id = ?")
            .run((e as Error).message, s.id);
        }
      }

      db.prepare("UPDATE courses SET status = 'ready', error = NULL WHERE id = ?").run(courseId);
    } catch (e) {
      db.prepare("UPDATE courses SET status = 'error', error = ? WHERE id = ?")
        .run((e as Error).message, courseId);
    } finally {
      running.delete(courseId);
    }
  })();
}

/** Parse a section's checkpoint JSON. */
export function sectionCheckpoint(sectionId: string) {
  const row = db.prepare("SELECT checkpoint FROM course_sections WHERE id = ?").get(sectionId) as
    | { checkpoint: string | null }
    | undefined;
  if (!row?.checkpoint) return [];
  try {
    return JSON.parse(row.checkpoint) as { question: string; options: string[]; correctIndex: number; explanation?: string }[];
  } catch {
    return [];
  }
}

export { COURSE_XP, awardSectionComplete };
