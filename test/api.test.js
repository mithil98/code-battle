import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.PISTON_URL = 'http://piston.test';
process.env.SUBMIT_COOLDOWN_MS = '0';

// Fake Piston: code containing GOOD prints the expected output for the current question's tests.
const realFetch = globalThis.fetch;
let fakeOutputs = new Map();
let pistonDown = false;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('http://piston.test')) return realFetch(url, opts);
  if (pistonDown) throw new TypeError('fetch failed');
  const body = JSON.parse(opts.body);
  const stdout = body.files[0].content.includes('GOOD') ? fakeOutputs.get(body.stdin) : 'nope';
  return Response.json({ run: { stdout, stderr: '', code: 0, signal: null } });
};

const { app } = await import('../server.js');
const { db } = await import('../db.js');
const seed = await import('../seed.js');

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, cookie) {
  const res = await realFetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const register = async (name, email) => (await call('POST', '/api/register', { name, email, password: 'battle-pass-1', college: 'VJTI Mumbai' })).cookie;
const roundId = (seq) => db.prepare('SELECT id FROM rounds WHERE seq = ?').get(seq).id;
const quizAnswers = (correctCount) => {
  const qs = db.prepare('SELECT id, answer FROM questions WHERE round_id = ? ORDER BY id').all(roundId(1));
  return Object.fromEntries(qs.map((q, i) => [q.id, i < correctCount ? q.answer : (q.answer + 1) % 4]));
};

let A, B, C, ADMIN;

test('register then me', async () => {
  const res = await call('POST', '/api/register', { name: 'Ria Kulkarni', email: 'ria@example.com', password: 'battle-pass-1', college: 'VJTI Mumbai' });
  assert.equal(res.status, 201);
  assert.match(res.cookie, /^cb_token=[a-f0-9]{64}$/);
  assert.equal(res.data.pass, undefined);
  A = res.cookie;
  const me = await call('GET', '/api/me', null, A);
  assert.equal(me.data.name, 'Ria Kulkarni');
});

test('registration and login validation', async () => {
  assert.equal((await call('POST', '/api/register', { name: 'Ria K', email: 'RIA@example.com', password: 'battle-pass-1' })).status, 409);
  assert.equal((await call('POST', '/api/register', { name: 'Dev', email: 'dev@example.com', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/login', { email: 'ria@example.com', password: 'wrong-pass' })).status, 401);
  assert.equal((await call('GET', '/api/me')).status, 401);
});

test('admin routes need the admin role', async () => {
  assert.equal((await call('GET', '/api/admin/users', null, A)).status, 403);
  ADMIN = (await call('POST', '/api/login', { email: 'admin@codebattle.local', password: 'admin-pass-123' })).cookie;
  assert.equal((await call('GET', '/api/admin/users', null, ADMIN)).status, 200);
});

test('start is blocked until the round is live, then idempotent and leak free', async () => {
  assert.equal((await call('POST', `/api/rounds/${roundId(1)}/start`, {}, A)).status, 403);
  await call('PATCH', `/api/admin/rounds/${roundId(1)}`, { status: 'live' }, ADMIN);
  const first = await call('POST', `/api/rounds/${roundId(1)}/start`, {}, A);
  const second = await call('POST', `/api/rounds/${roundId(1)}/start`, {}, A);
  assert.equal(first.status, 200);
  assert.equal(first.data.deadline, second.data.deadline);
  assert.equal(first.data.questions.length, 10);
  assert.ok(!JSON.stringify(first.data).includes('"answer"'));
});

test('quiz scoring and single submission', async () => {
  const res = await call('POST', `/api/rounds/${roundId(1)}/quiz`, { answers: quizAnswers(10) }, A);
  assert.equal(res.status, 200);
  assert.equal(res.data.score, 100);
  assert.equal((await call('POST', `/api/rounds/${roundId(1)}/quiz`, { answers: quizAnswers(10) }, A)).status, 409);
});

test('ties share rank and qualification includes boundary ties', async () => {
  B = await register('Arjun Mehta', 'arjun@example.com');
  C = await register('Sana Qureshi', 'sana@example.com');
  for (const [user, correct] of [[B, 10], [C, 5]]) {
    await call('POST', `/api/rounds/${roundId(1)}/start`, {}, user);
    await call('POST', `/api/rounds/${roundId(1)}/quiz`, { answers: quizAnswers(correct) }, user);
  }
  const board = (await call('GET', '/api/leaderboard')).data.rows;
  assert.deepEqual(board.map((r) => [r.name, r.rank, r.total]), [['Arjun Mehta', 1, 100], ['Ria Kulkarni', 1, 100], ['Sana Qureshi', 3, 50]]);

  await call('PATCH', `/api/admin/rounds/${roundId(1)}`, { qualify_count: 1 }, ADMIN);
  const q = await call('POST', `/api/admin/rounds/${roundId(1)}/qualify`, {}, ADMIN);
  assert.equal(q.data.qualified, 2);
  await call('PATCH', `/api/admin/rounds/${roundId(2)}`, { status: 'live' }, ADMIN);
  assert.equal((await call('POST', `/api/rounds/${roundId(2)}/start`, {}, C)).status, 403);
  const start = await call('POST', `/api/rounds/${roundId(2)}/start`, {}, A);
  assert.equal(start.status, 200);
  const sumDigits = start.data.questions[0];
  assert.equal(sumDigits.samples.length, 2);
  assert.equal(sumDigits.hiddenCount, 3);
  assert.equal(sumDigits.tests, undefined);
  const overview = await call('GET', '/api/me/overview', null, C);
  assert.equal(overview.data.rounds[1].eliminated, true);
});

test('code submission scoring, language check, deadline', async () => {
  const q = db.prepare('SELECT * FROM questions WHERE round_id = ? ORDER BY id').get(roundId(2));
  fakeOutputs = new Map(JSON.parse(q.tests).map((t) => [t.input + '\n', t.output]));
  const good = await call('POST', `/api/questions/${q.id}/submit`, { language: 'python', code: 'print("GOOD")' }, A);
  assert.equal(good.status, 200);
  assert.equal(good.data.passed, 5);
  assert.equal(good.data.score, 100);
  assert.equal(good.data.results.filter((r) => r.hidden && 'expected' in r).length, 0);
  const bad = await call('POST', `/api/questions/${q.id}/submit`, { language: 'python', code: 'print(1)' }, A);
  assert.equal(bad.data.score, 0);
  assert.equal(bad.data.best, 100);
  assert.equal((await call('POST', `/api/questions/${q.id}/submit`, { language: 'ruby', code: 'puts 1' }, A)).status, 400);

  db.prepare('UPDATE attempts SET deadline = ? WHERE round_id = ?').run(Date.now() - 10000, roundId(2));
  assert.equal((await call('POST', `/api/questions/${q.id}/submit`, { language: 'python', code: 'print("GOOD")' }, A)).status, 403);
});

test('runner outage returns 503 and stores nothing', async () => {
  await call('POST', `/api/rounds/${roundId(2)}/start`, {}, B);
  const q = db.prepare('SELECT * FROM questions WHERE round_id = ? ORDER BY id').get(roundId(2));
  const before = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
  pistonDown = true;
  const res = await call('POST', `/api/questions/${q.id}/submit`, { language: 'python', code: 'print("GOOD")' }, B);
  pistonDown = false;
  assert.equal(res.status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, before);
});

test('admin override changes totals and publish flips the leaderboard', async () => {
  const subs = (await call('GET', `/api/admin/submissions?round=${roundId(2)}`, null, ADMIN)).data;
  const top = subs.find((s) => s.score === 100);
  assert.equal((await call('PATCH', `/api/admin/submissions/${top.id}`, { score: 0 }, ADMIN)).status, 200);
  const ria = (await call('GET', '/api/leaderboard')).data.rows.find((r) => r.name === 'Ria Kulkarni');
  assert.equal(ria.total, 100);
  await call('POST', '/api/admin/publish', { published: true }, ADMIN);
  assert.equal((await call('GET', '/api/leaderboard')).data.published, true);
});

test('admin question validation', async () => {
  const bad = await call('POST', '/api/admin/questions', { round_id: roundId(1), title: 'Pick one', points: 10, options: ['only'], answer: 0 }, ADMIN);
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/admin/questions', { round_id: roundId(2), title: 'Echo', points: 50, starter: { python: 'print(input())' }, tests: [{ input: 'hi', output: 'hi' }] }, ADMIN);
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.data.tests, [{ input: 'hi', output: 'hi', hidden: false }]);
});

test('seed data is consistent', () => {
  for (const q of seed.questions) {
    if (q.options) assert.ok(q.answer >= 0 && q.answer < q.options.length, q.title);
    else assert.ok(q.tests.length >= 3 && Object.keys(q.starter).length >= 2, q.title);
  }
});
