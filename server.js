import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, hash, verify, tx } from './db.js';
import { runCode, runnerStatus, ensureRuntimes, LANGUAGES } from './runner.js';
import { canEnter, bestScores, roundRanking, leaderboard, qualify } from './scoring.js';

const GRACE_MS = 5000;
const SESSION_MS = 7 * 24 * 3600 * 1000;
const SUBMIT_COOLDOWN_MS = Number(process.env.SUBMIT_COOLDOWN_MS ?? 3000);
const MAX_CODE = 64 * 1024;

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const int = (v) => (Number.isInteger(Number(v)) && String(v).trim() !== '' ? Number(v) : NaN);
const parse = (json, fallback) => (json ? JSON.parse(json) : fallback);
const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
const getRound = (id) => db.prepare('SELECT * FROM rounds WHERE id = ?').get(int(id));

// ---------- auth ----------

function startSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());
  res.cookie('cb_token', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS, secure: process.env.COOKIE_SECURE === '1' });
}

function auth(req, res, next) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)cb_token=([a-f0-9]{64})/)?.[1];
  const user = token && db.prepare(`
    SELECT u.id, u.name, u.email, u.college, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.created_at > ?`).get(token, Date.now() - SESSION_MS);
  if (!user) throw fail(401, 'Please log in to continue');
  req.user = user;
  req.token = token;
  next();
}

function admin(req, res, next) {
  if (req.user.role !== 'admin') throw fail(403, 'Admins only');
  next();
}

app.post('/api/register', (req, res) => {
  const name = text(req.body?.name, 60);
  const email = text(req.body?.email, 120).toLowerCase();
  const college = text(req.body?.college, 100);
  const password = String(req.body?.password ?? '');
  if (name.length < 2) throw fail(400, 'Enter your full name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address');
  if (password.length < 8 || password.length > 200) throw fail(400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw fail(409, 'An account with this email already exists');
  const id = Number(db.prepare('INSERT INTO users (name, email, college, pass, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, college, hash(password), Date.now()).lastInsertRowid);
  startSession(res, id);
  res.status(201).json({ id, name, email, college, role: 'participant' });
});

app.post('/api/login', (req, res) => {
  const email = text(req.body?.email, 120).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verify(String(req.body?.password ?? ''), user.pass)) throw fail(401, 'Wrong email or password');
  startSession(res, user.id);
  res.json({ id: user.id, name: user.name, email: user.email, college: user.college, role: user.role });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.clearCookie('cb_token').json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

// ---------- participant ----------

function roundSummary(round, userId) {
  const stats = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS max FROM questions WHERE round_id = ?').get(round.id);
  const attempt = db.prepare('SELECT deadline, finished FROM attempts WHERE user_id = ? AND round_id = ?').get(userId, round.id) ?? null;
  const qualified = round.seq === 1 || !!db.prepare('SELECT 1 FROM qualified WHERE user_id = ? AND round_id = ?').get(userId, round.id);
  const prev = db.prepare('SELECT status FROM rounds WHERE seq = ?').get(round.seq - 1);
  const ranking = roundRanking(round.id);
  const mine = ranking.find((r) => r.user_id === userId);
  const points = Object.fromEntries(db.prepare('SELECT id, points FROM questions WHERE round_id = ?').all(round.id).map((q) => [q.id, q.points]));
  const best = bestScores(userId, round.id);
  return {
    id: round.id, seq: round.seq, title: round.title, type: round.type, about: round.about,
    duration_min: round.duration_min, qualify_count: round.qualify_count, status: round.status,
    questionCount: stats.n, maxScore: stats.max,
    myScore: mine?.score ?? 0, myRank: mine?.rank ?? null, ranked: ranking.length,
    solved: Object.entries(best).filter(([qid, s]) => s >= points[qid]).length,
    qualified, eliminated: !qualified && prev?.status === 'ended',
    canEnter: canEnter(userId, round), attempt,
  };
}

app.get('/api/me/overview', auth, (req, res) => {
  const board = leaderboard();
  const me = board.find((r) => r.userId === req.user.id);
  const rounds = db.prepare('SELECT * FROM rounds ORDER BY seq').all().map((r) => roundSummary(r, req.user.id));
  const recent = db.prepare(`
    SELECT s.id, q.title AS question, r.title AS round, s.language, s.passed, s.total, s.score, s.created_at
    FROM submissions s JOIN questions q ON q.id = s.question_id JOIN rounds r ON r.id = s.round_id
    WHERE s.user_id = ? AND s.language != 'quiz' ORDER BY s.id DESC LIMIT 10`).all(req.user.id);
  res.json({ total: me?.total ?? 0, rank: me?.rank ?? null, participants: board.length, rounds, recent });
});

app.get('/api/rounds/:id', auth, (req, res) => {
  const round = getRound(req.params.id);
  if (!round) throw fail(404, 'Round not found');
  res.json(roundSummary(round, req.user.id));
});

function roundPayload(round, userId, attempt) {
  const questions = db.prepare('SELECT * FROM questions WHERE round_id = ? ORDER BY id').all(round.id);
  const best = bestScores(userId, round.id);
  const base = { round: roundSummary(round, userId), deadline: attempt.deadline, finished: !!attempt.finished, now: Date.now() };
  if (round.type === 'quiz') {
    const result = attempt.finished ? db.prepare('SELECT COALESCE(SUM(score), 0) AS score, COALESCE(SUM(passed), 0) AS correct, COUNT(*) AS total FROM submissions WHERE user_id = ? AND round_id = ?').get(userId, round.id) : null;
    return { ...base, result, questions: questions.map((q) => ({ id: q.id, title: q.title, body: q.body, points: q.points, options: parse(q.options, []) })) };
  }
  const last = db.prepare('SELECT language, code FROM submissions WHERE user_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1');
  return {
    ...base,
    languages: Object.fromEntries(Object.entries(LANGUAGES).map(([id, l]) => [id, l.label])),
    questions: questions.map((q) => {
      const tests = parse(q.tests, []);
      const starter = parse(q.starter, {});
      return {
        id: q.id, title: q.title, body: q.body, points: q.points, starter,
        languages: Object.keys(starter).filter((l) => LANGUAGES[l]),
        samples: tests.filter((t) => !t.hidden).map(({ input, output }) => ({ input, output })),
        hiddenCount: tests.filter((t) => t.hidden).length,
        best: best[q.id] ?? null, last: last.get(userId, q.id) ?? null,
      };
    }),
  };
}

app.post('/api/rounds/:id/start', auth, (req, res) => {
  const round = getRound(req.params.id);
  if (!round) throw fail(404, 'Round not found');
  let attempt = db.prepare('SELECT * FROM attempts WHERE user_id = ? AND round_id = ?').get(req.user.id, round.id);
  if (!canEnter(req.user.id, round)) {
    // A finished or ended round can still be reviewed by those who played it.
    if (!attempt || round.status === 'upcoming') {
      throw fail(403, round.status === 'live' ? 'You have not qualified for this round' : 'This round is not live');
    }
  }
  if (!attempt) {
    const now = Date.now();
    db.prepare('INSERT INTO attempts (user_id, round_id, started_at, deadline) VALUES (?, ?, ?, ?)')
      .run(req.user.id, round.id, now, now + round.duration_min * 60000);
    attempt = db.prepare('SELECT * FROM attempts WHERE user_id = ? AND round_id = ?').get(req.user.id, round.id);
  }
  res.json(roundPayload(round, req.user.id, attempt));
});

function openAttempt(userId, round) {
  if (!canEnter(userId, round)) throw fail(403, round.status === 'live' ? 'You have not qualified for this round' : 'This round is not live');
  const attempt = db.prepare('SELECT * FROM attempts WHERE user_id = ? AND round_id = ?').get(userId, round.id);
  if (!attempt) throw fail(403, 'Start the round first');
  if (Date.now() > attempt.deadline + GRACE_MS) throw fail(403, 'Time is up for this round');
  return attempt;
}

app.post('/api/rounds/:id/quiz', auth, (req, res) => {
  const round = getRound(req.params.id);
  if (!round || round.type !== 'quiz') throw fail(404, 'Quiz round not found');
  const attempt = openAttempt(req.user.id, round);
  if (attempt.finished) throw fail(409, 'You already submitted this quiz');
  const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  const questions = db.prepare('SELECT id, points, answer FROM questions WHERE round_id = ?').all(round.id);
  const now = Date.now();
  const result = tx(() => {
    const add = db.prepare('INSERT INTO submissions (user_id, round_id, question_id, language, code, passed, total, score, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
    let score = 0, correct = 0;
    for (const q of questions) {
      const chosen = Number.isInteger(answers[q.id]) ? answers[q.id] : null;
      const ok = chosen === q.answer;
      add.run(req.user.id, round.id, q.id, 'quiz', String(chosen ?? ''), ok ? 1 : 0, ok ? q.points : 0, now);
      score += ok ? q.points : 0;
      correct += ok ? 1 : 0;
    }
    db.prepare('UPDATE attempts SET finished = 1 WHERE user_id = ? AND round_id = ?').run(req.user.id, round.id);
    return { score, correct, total: questions.length };
  });
  res.json(result);
});

// ponytail: in-memory cooldown, resets on restart; move to the DB if running several app instances.
const lastSubmit = new Map();

app.post('/api/questions/:id/submit', auth, async (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(int(req.params.id));
  const round = q && getRound(q.round_id);
  if (!round || round.type !== 'code') throw fail(404, 'Question not found');
  openAttempt(req.user.id, round);
  const language = String(req.body?.language ?? '');
  const code = String(req.body?.code ?? '');
  if (!LANGUAGES[language] || !(language in parse(q.starter, {}))) throw fail(400, 'This language is not allowed for this question');
  if (!code.trim()) throw fail(400, 'Write some code before submitting');
  if (code.length > MAX_CODE) throw fail(400, 'Code is too long (64 KB max)');
  const wait = (lastSubmit.get(req.user.id) ?? 0) + SUBMIT_COOLDOWN_MS - Date.now();
  if (wait > 0) throw fail(429, `Please wait ${Math.ceil(wait / 1000)} s before submitting again`);
  lastSubmit.set(req.user.id, Date.now());

  const tests = parse(q.tests, []);
  let run;
  try {
    run = await runCode(language, code, tests);
  } catch (err) {
    console.error('Runner error:', err.message);
    throw fail(503, 'The code runner is unavailable right now. Your submission was not counted, please try again.');
  }
  const score = Math.round((q.points * run.passed) / run.total);
  db.prepare('INSERT INTO submissions (user_id, round_id, question_id, language, code, passed, total, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, round.id, q.id, language, code, run.passed, run.total, score, Date.now());
  res.json({
    score, passed: run.passed, total: run.total, best: bestScores(req.user.id, round.id)[q.id],
    results: run.results.map((r, i) => (tests[i].hidden
      ? { ok: r.ok, hidden: true, error: r.error }
      : { ...r, hidden: false, input: tests[i].input, expected: tests[i].output })),
  });
});

app.get('/api/leaderboard', (req, res) => {
  res.json({
    published: setting('results_published') === '1',
    rounds: db.prepare('SELECT id, seq, title, type, about, duration_min, qualify_count, status FROM rounds ORDER BY seq').all(),
    rows: leaderboard(),
  });
});

// ---------- admin ----------

const adminApi = express.Router();
adminApi.use(auth, admin);
app.use('/api/admin', adminApi);

adminApi.get('/runner', async (req, res) => res.json(await runnerStatus()));

adminApi.get('/rounds', (req, res) => {
  res.json(db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM questions q WHERE q.round_id = r.id) AS questions,
      (SELECT COUNT(*) FROM attempts a WHERE a.round_id = r.id) AS attempts,
      (SELECT COUNT(*) FROM qualified x WHERE x.round_id = r.id) AS qualified
    FROM rounds r ORDER BY seq`).all());
});

adminApi.patch('/rounds/:id', (req, res) => {
  const round = getRound(req.params.id);
  if (!round) throw fail(404, 'Round not found');
  const { status = round.status, duration_min = round.duration_min, qualify_count = round.qualify_count } = req.body ?? {};
  if (!['upcoming', 'live', 'ended'].includes(status)) throw fail(400, 'Invalid status');
  const duration = int(duration_min);
  if (!(duration >= 1 && duration <= 600)) throw fail(400, 'Duration must be 1 to 600 minutes');
  const quota = qualify_count === null || qualify_count === '' ? null : int(qualify_count);
  if (quota !== null && !(quota >= 1)) throw fail(400, 'Qualify count must be a positive number or empty');
  db.prepare('UPDATE rounds SET status = ?, duration_min = ?, qualify_count = ? WHERE id = ?').run(status, duration, quota, round.id);
  res.json(getRound(round.id));
});

adminApi.post('/rounds/:id/qualify', (req, res) => {
  if (!getRound(req.params.id)) throw fail(404, 'Round not found');
  res.json(qualify(int(req.params.id)));
});

function questionFields(body, round) {
  const title = text(body?.title, 300);
  const points = int(body?.points);
  if (!title) throw fail(400, 'Title is required');
  if (!(points >= 1 && points <= 1000)) throw fail(400, 'Points must be 1 to 1000');
  const fields = { title, body: String(body?.body ?? '').slice(0, 5000), points, options: null, answer: null, starter: null, tests: null };
  if (round.type === 'quiz') {
    const options = (Array.isArray(body?.options) ? body.options : []).map((o) => text(o, 200)).filter(Boolean);
    const answer = int(body?.answer);
    if (options.length < 2 || options.length > 6) throw fail(400, 'A quiz question needs 2 to 6 options');
    if (!(answer >= 0 && answer < options.length)) throw fail(400, 'Pick which option is correct');
    return { ...fields, options: JSON.stringify(options), answer };
  }
  const starter = Object.fromEntries(Object.entries(body?.starter ?? {})
    .filter(([lang, code]) => LANGUAGES[lang] && typeof code === 'string' && code.trim()));
  const tests = Array.isArray(body?.tests) ? body.tests : [];
  if (!Object.keys(starter).length) throw fail(400, 'Add starter code for at least one language');
  if (!tests.length || tests.length > 30) throw fail(400, 'Add 1 to 30 test cases');
  if (!tests.every((t) => typeof t?.input === 'string' && typeof t?.output === 'string')) throw fail(400, 'Each test needs string "input" and "output"');
  return { ...fields, starter: JSON.stringify(starter), tests: JSON.stringify(tests.map((t) => ({ input: t.input, output: t.output, hidden: !!t.hidden }))) };
}

const fullQuestion = (q) => ({ ...q, options: parse(q.options, null), starter: parse(q.starter, null), tests: parse(q.tests, null) });

adminApi.get('/questions', (req, res) => {
  res.json(db.prepare('SELECT * FROM questions WHERE round_id = ? ORDER BY id').all(int(req.query.round)).map(fullQuestion));
});

adminApi.post('/questions', (req, res) => {
  const round = getRound(req.body?.round_id);
  if (!round) throw fail(400, 'Pick a round');
  const f = questionFields(req.body, round);
  const id = db.prepare('INSERT INTO questions (round_id, title, body, points, options, answer, starter, tests) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(round.id, f.title, f.body, f.points, f.options, f.answer, f.starter, f.tests).lastInsertRowid;
  res.status(201).json(fullQuestion(db.prepare('SELECT * FROM questions WHERE id = ?').get(id)));
});

adminApi.put('/questions/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(int(req.params.id));
  if (!q) throw fail(404, 'Question not found');
  const f = questionFields(req.body, getRound(q.round_id));
  db.prepare('UPDATE questions SET title = ?, body = ?, points = ?, options = ?, answer = ?, starter = ?, tests = ? WHERE id = ?')
    .run(f.title, f.body, f.points, f.options, f.answer, f.starter, f.tests, q.id);
  res.json(fullQuestion(db.prepare('SELECT * FROM questions WHERE id = ?').get(q.id)));
});

adminApi.delete('/questions/:id', (req, res) => {
  db.prepare('DELETE FROM questions WHERE id = ?').run(int(req.params.id));
  res.json({ ok: true });
});

// Open Trivia DB: free, no key, category 18 = Science: Computers. https://opentdb.com/api_config.php
adminApi.post('/import-trivia', async (req, res) => {
  const round = getRound(req.body?.round_id);
  if (!round || round.type !== 'quiz') throw fail(400, 'Pick a quiz round');
  const amount = int(req.body?.amount);
  if (!(amount >= 1 && amount <= 30)) throw fail(400, 'Import 1 to 30 questions at a time');
  const difficulty = ['easy', 'medium', 'hard'].includes(req.body?.difficulty) ? req.body.difficulty : '';
  const url = `https://opentdb.com/api.php?amount=${amount}&category=18&type=multiple&encode=url3986${difficulty ? `&difficulty=${difficulty}` : ''}`;
  let data;
  try {
    data = await (await fetch(url, { signal: AbortSignal.timeout(10000) })).json();
  } catch {
    throw fail(502, 'Could not reach Open Trivia DB');
  }
  if (data.response_code === 5) throw fail(429, 'Open Trivia DB allows one request every 5 seconds. Try again shortly.');
  if (data.response_code !== 0 || !data.results?.length) throw fail(502, 'Open Trivia DB has no questions for that filter');
  const points = int(req.body?.points) >= 1 ? int(req.body.points) : 10;
  const add = db.prepare('INSERT INTO questions (round_id, title, points, options, answer) VALUES (?, ?, ?, ?, ?)');
  tx(() => {
    for (const r of data.results) {
      const options = r.incorrect_answers.map(decodeURIComponent);
      const answer = Math.floor(Math.random() * (options.length + 1));
      options.splice(answer, 0, decodeURIComponent(r.correct_answer));
      add.run(round.id, decodeURIComponent(r.question).slice(0, 300), points, JSON.stringify(options), answer);
    }
  });
  res.json({ imported: data.results.length });
});

adminApi.get('/submissions', (req, res) => {
  res.json(db.prepare(`
    SELECT s.id, s.user_id, u.name, u.email, q.title AS question, q.points, s.language, s.code, s.passed, s.total, s.score, s.overridden, s.created_at
    FROM submissions s JOIN users u ON u.id = s.user_id JOIN questions q ON q.id = s.question_id
    WHERE s.round_id = ? ORDER BY s.id DESC LIMIT 500`).all(int(req.query.round)));
});

adminApi.patch('/submissions/:id', (req, res) => {
  const s = db.prepare('SELECT s.id, q.points FROM submissions s JOIN questions q ON q.id = s.question_id WHERE s.id = ?').get(int(req.params.id));
  if (!s) throw fail(404, 'Submission not found');
  const score = int(req.body?.score);
  if (!(score >= 0 && score <= s.points)) throw fail(400, `Score must be 0 to ${s.points}`);
  db.prepare('UPDATE submissions SET score = ?, overridden = 1 WHERE id = ?').run(score, s.id);
  res.json({ ok: true, score });
});

adminApi.get('/users', (req, res) => {
  const board = Object.fromEntries(leaderboard().map((r) => [r.userId, r]));
  res.json(db.prepare("SELECT id, name, email, college, created_at FROM users WHERE role = 'participant' ORDER BY id").all()
    .map((u) => ({ ...u, total: board[u.id]?.total ?? 0, rank: board[u.id]?.rank ?? null })));
});

adminApi.post('/publish', (req, res) => {
  const published = req.body?.published === true;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'results_published'").run(published ? '1' : '0');
  res.json({ published });
});

// ---------- errors ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500 && !err.status) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong' : err.message });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Code Battle running on http://localhost:${port}`));
  ensureRuntimes();
}
