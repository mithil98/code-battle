import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { rounds, questions } from './seed.js';

export const db = new DatabaseSync(process.env.DB_FILE || 'codebattle.db');

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    college TEXT NOT NULL DEFAULT '',
    pass TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'admin')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('quiz', 'code')),
    about TEXT NOT NULL DEFAULT '',
    duration_min INTEGER NOT NULL,
    qualify_count INTEGER,
    status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'ended'))
  );
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    points INTEGER NOT NULL,
    options TEXT,
    answer INTEGER,
    starter TEXT,
    tests TEXT
  );
  CREATE TABLE IF NOT EXISTS attempts (
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    round_id INTEGER NOT NULL REFERENCES rounds ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    deadline INTEGER NOT NULL,
    finished INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, round_id)
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    round_id INTEGER NOT NULL REFERENCES rounds ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions ON DELETE CASCADE,
    language TEXT NOT NULL,
    code TEXT NOT NULL,
    passed INTEGER NOT NULL,
    total INTEGER NOT NULL,
    score INTEGER NOT NULL,
    overridden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS submissions_user ON submissions (user_id, question_id);
  CREATE TABLE IF NOT EXISTS qualified (
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    round_id INTEGER NOT NULL REFERENCES rounds ON DELETE CASCADE,
    PRIMARY KEY (user_id, round_id)
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO settings (key, value) VALUES ('results_published', '0');
`);

export function hash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verify(password, stored) {
  const [salt, key] = stored.split(':');
  const expected = Buffer.from(key, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
  const email = (process.env.ADMIN_EMAIL || 'admin@codebattle.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO users (name, email, pass, role, created_at) VALUES ('Admin', ?, ?, 'admin', ?)")
    .run(email, hash(password), Date.now());
  if (!process.env.ADMIN_PASSWORD) console.log(`Admin account created: ${email} / ${password} (shown once)`);
}

if (!db.prepare('SELECT 1 FROM rounds').get()) {
  tx(() => {
    const roundIds = {};
    const addRound = db.prepare('INSERT INTO rounds (seq, title, type, about, duration_min, qualify_count) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of rounds) {
      roundIds[r.seq] = Number(addRound.run(r.seq, r.title, r.type, r.about, r.duration_min, r.qualify_count).lastInsertRowid);
    }
    const addQuestion = db.prepare('INSERT INTO questions (round_id, title, body, points, options, answer, starter, tests) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const q of questions) {
      addQuestion.run(roundIds[q.round], q.title, q.body, q.points,
        q.options ? JSON.stringify(q.options) : null, q.answer ?? null,
        q.starter ? JSON.stringify(q.starter) : null, q.tests ? JSON.stringify(q.tests) : null);
    }
  });
}
