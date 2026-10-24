import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// --- storage locations -------------------------------------------------
const dataDir = join(homedir(), ".studyforge");
mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, "uploads"), { recursive: true });
mkdirSync(join(dataDir, "extracted"), { recursive: true });

export const DATA_DIR = dataDir;
export const UPLOADS_DIR = join(dataDir, "uploads");
export const EXTRACTED_DIR = join(dataDir, "extracted");
export const DB_PATH = join(dataDir, "studyforge.db");

export const db = new DatabaseSync(DB_PATH);

// --- schema --------------------------------------------------------------
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT NOT NULL,          -- JSON array of strings
  correct_index INTEGER NOT NULL,
  explanation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('quiz', 'review', 'course_final')),
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  xp_earned INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  xp INTEGER NOT NULL DEFAULT 0,
  streak_count INTEGER NOT NULL DEFAULT 0,
  last_study_date TEXT
);

INSERT OR IGNORE INTO progress (id, xp) VALUES (1, 0);

-- Migration: older databases have an attempts table whose CHECK constraint
-- lacks 'course_final'. SQLite can't alter CHECK constraints, so recreate.
-- (Invalid row data is impossible: kind values were only quiz/review before.)
CREATE TABLE IF NOT EXISTS attempts_new (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('quiz', 'review', 'course_final')),
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  xp_earned INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO attempts_new
  SELECT id, document_id, kind, score, total, xp_earned, created_at FROM attempts
  WHERE kind IN ('quiz', 'review', 'course_final');
DROP TABLE attempts;
ALTER TABLE attempts_new RENAME TO attempts;

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  intro TEXT NOT NULL,
  coverage TEXT,
  goal TEXT,
  familiarity TEXT,
  status TEXT NOT NULL DEFAULT 'generating',
  error TEXT,
  warmup_done INTEGER NOT NULL DEFAULT 0,
  warmup_answers TEXT,
  final_done INTEGER NOT NULL DEFAULT 0,
  final_best_score INTEGER,
  final_total INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS course_sections (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  checkpoint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  checkpoint_score INTEGER,
  checkpoint_total INTEGER,
  UNIQUE (course_id, idx)
);

CREATE TABLE IF NOT EXISTS course_questions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('warmup','final')),
  idx INTEGER NOT NULL,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT
);
`);

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export type Progress = {
  xp: number;
  streakCount: number;
  lastStudyDate: string | null;
};

export function getProgress(): Progress {
  const row = db.prepare("SELECT xp, streak_count, last_study_date FROM progress WHERE id = 1").get() as {
    xp: number;
    streak_count: number;
    last_study_date: string | null;
  };
  return { xp: row.xp, streakCount: row.streak_count, lastStudyDate: row.last_study_date };
}

/** XP awarded per correct answer. */
export const XP_PER_CORRECT = 10;

/**
 * Award XP and update the daily streak. Returns the new totals plus what
 * changed so the UI can celebrate (level-up popup, streak chime, etc).
 */
export function awardXp(amount: number): {
  xp: number;
  xpGained: number;
  leveledUp: boolean;
  levelBefore: number;
  level: number;
  streak: number;
  streakCount: number;
  streakIncreased: boolean;
} {
  const before = getProgress();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  let streak = before.streakCount;
  let streakIncreased = false;
  if (before.lastStudyDate !== today) {
    if (before.lastStudyDate === yesterday) {
      streak += 1;
      streakIncreased = true;
    } else {
      streak = 1;
      streakIncreased = before.streakCount > 0 || streak === 1;
    }
  }

  const levelBefore = levelFromXp(before.xp);
  const xp = before.xp + amount;
  const level = levelFromXp(xp);

  db.prepare("UPDATE progress SET xp = ?, streak_count = ?, last_study_date = ? WHERE id = 1")
    .run(xp, streak, today);

  return {
    xp,
    xpGained: amount,
    leveledUp: level > levelBefore,
    levelBefore,
    level,
    streak,
    streakCount: streak,
    streakIncreased,
  };
}

// --- course rewards -------------------------------------------------------

export const COURSE_XP = {
  warmup: 15,
  section: 30,
  checkpointCorrect: 10,
  checkpointPerfect: 10,
  finalCorrect: 12,
  finalPerfect: 40,
};

/** Award XP for completing a course section (first time only). */
export function awardSectionComplete(): number {
  const p = awardXp(COURSE_XP.section);
  return p.xpGained;
}

// --- misc helpers used across api/ai -----------------------------------------

export function getCourseRow(courseId: string) {
  return db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId) as
    | Record<string, unknown>
    | undefined;
}

/** Full progress payload for the UI HUD, including level math. */
export function getProgressHud() {
  const p = getProgress();
  return { ...p, ...levelInfo(p.xp) };
}

/** Level thresholds grow by 250 XP each level: L1 at 0, L2 at 250, ... */
export function levelFromXp(xp: number): number {
  return Math.floor(xp / 250) + 1;
}

/** How many XP are still needed to reach the next level (and the level goal). */
export function levelInfo(xp: number): { level: number; into: number; span: number; nextAt: number } {
  const level = levelFromXp(xp);
  const base = (level - 1) * 250;
  const into = xp - base;
  return { level, into, span: 250, nextAt: base + 250 };
}
