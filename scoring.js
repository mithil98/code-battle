import { db, tx } from './db.js';

// Best score per user per question; every total in the app is built from this.
const BEST = `best AS (
  SELECT user_id, round_id, question_id, MAX(score) AS s FROM submissions GROUP BY user_id, round_id, question_id
)`;

export function canEnter(userId, round) {
  if (round.status !== 'live') return false;
  if (round.seq === 1) return true;
  return !!db.prepare('SELECT 1 FROM qualified WHERE user_id = ? AND round_id = ?').get(userId, round.id);
}

export function bestScores(userId, roundId) {
  const rows = db.prepare(`WITH ${BEST} SELECT question_id, s FROM best WHERE user_id = ? AND round_id = ?`).all(userId, roundId);
  return Object.fromEntries(rows.map((r) => [r.question_id, r.s]));
}

// Everyone who started the round, ranked by round score. Ties share a rank.
export function roundRanking(roundId) {
  return db.prepare(`
    WITH ${BEST}
    SELECT a.user_id, COALESCE(SUM(b.s), 0) AS score, RANK() OVER (ORDER BY COALESCE(SUM(b.s), 0) DESC) AS rank
    FROM attempts a LEFT JOIN best b ON b.user_id = a.user_id AND b.round_id = a.round_id
    WHERE a.round_id = ? GROUP BY a.user_id`).all(roundId);
}

export function leaderboard() {
  const rows = db.prepare(`
    WITH ${BEST}, totals AS (
      SELECT u.id, u.name, u.college, COALESCE(SUM(b.s), 0) AS total
      FROM users u LEFT JOIN best b ON b.user_id = u.id
      WHERE u.role = 'participant' GROUP BY u.id
    )
    SELECT id AS userId, name, college, total, RANK() OVER (ORDER BY total DESC) AS rank
    FROM totals ORDER BY rank, name COLLATE NOCASE`).all();
  const perRound = db.prepare(`WITH ${BEST} SELECT user_id, round_id, SUM(s) AS s FROM best GROUP BY user_id, round_id`).all();
  const scores = {};
  for (const r of perRound) (scores[r.user_id] ??= {})[r.round_id] = r.s;
  return rows.map((r) => ({ ...r, scores: scores[r.userId] ?? {} }));
}

// Ends the round and qualifies its top `qualify_count` (boundary ties included) for the next round.
export function qualify(roundId) {
  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
  const next = round && db.prepare('SELECT id, title FROM rounds WHERE seq = ?').get(round.seq + 1);
  return tx(() => {
    db.prepare("UPDATE rounds SET status = 'ended' WHERE id = ?").run(roundId);
    if (!next || round.qualify_count == null) return { qualified: 0, next: next ?? null };
    const top = roundRanking(roundId).filter((r) => r.rank <= round.qualify_count);
    const add = db.prepare('INSERT OR IGNORE INTO qualified (user_id, round_id) VALUES (?, ?)');
    for (const r of top) add.run(r.user_id, next.id);
    return { qualified: top.length, next };
  });
}
