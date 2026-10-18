import { api, requireUser, renderNav, poll, esc, statusBadge, ordinal, timeOf, toast } from './app.js';

const user = await requireUser('participant');
renderNav(user, 'Dashboard');
document.getElementById('greeting').textContent = `Hi, ${user.name.split(' ')[0]}`;

const LANG = { python: 'Python', javascript: 'JavaScript', cpp: 'C++', java: 'Java' };

function stateBadge(r) {
  if (r.eliminated) return '<span class="badge badge-bad">Eliminated</span>';
  if (!r.qualified) return '<span class="badge">Qualify to unlock</span>';
  if (r.seq > 1) return '<span class="badge badge-ok">Qualified</span>';
  return '';
}

function action(r) {
  const running = r.attempt && !r.attempt.finished && r.attempt.deadline > Date.now();
  if (r.canEnter && !r.attempt) return `<a class="btn btn-primary btn-sm" href="/round.html?id=${r.id}">Start round</a>`;
  if (r.canEnter && running) return `<a class="btn btn-primary btn-sm" href="/round.html?id=${r.id}">Resume</a>`;
  if (r.attempt && r.status !== 'upcoming') return `<a class="btn btn-ghost btn-sm" href="/round.html?id=${r.id}">Review</a>`;
  return '';
}

function renderRounds(rounds) {
  let out = false;
  document.getElementById('rounds').innerHTML = rounds.map((r) => {
    // Once eliminated, later rounds need no qualification hint.
    const badge = out ? '' : stateBadge(r);
    out ||= r.eliminated;
    return `
    <li class="round-item ${r.status === 'live' ? 'is-live' : ''}">
      <span class="round-seq" aria-hidden="true">${r.seq}</span>
      <div class="round-info">
        <div class="row" style="gap:8px"><h3>${esc(r.title)}</h3>${statusBadge(r.status)}${badge}</div>
        <div class="round-meta">
          <span>${r.type === 'quiz' ? 'Multiple choice' : 'Code'}</span>
          <span>${r.duration_min} min</span>
          <span>${r.questionCount} question${r.questionCount === 1 ? '' : 's'}</span>
          ${r.attempt ? `<span>${r.solved} solved</span>` : ''}
        </div>
      </div>
      <div class="round-score">
        <div><span class="num" style="font-weight:600">${r.myScore}</span><span class="muted num"> / ${r.maxScore}</span>
          ${r.myRank ? `<div class="muted" style="font-size:.8rem">Rank ${ordinal(r.myRank)} of ${r.ranked}</div>` : ''}</div>
        ${action(r)}
      </div>
    </li>`;
  }).join('');
}

function renderRecent(recent) {
  document.getElementById('recent').innerHTML = recent.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Problem</th><th class="num">Tests</th><th class="num">Score</th></tr></thead>
        <tbody>${recent.map((s) => `
          <tr>
            <td><div class="person-name" style="white-space:normal">${esc(s.question)}</div><div class="person-sub">${LANG[s.language] ?? esc(s.language)} at ${timeOf(s.created_at)}</div></td>
            <td class="num"><span class="badge ${s.passed === s.total ? 'badge-ok' : s.passed ? 'badge-warn' : 'badge-bad'}">${s.passed}/${s.total}</span></td>
            <td class="num">${s.score}</td>
          </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><i class="ph ph-code" aria-hidden="true"></i><p>No code submissions yet. They show up here once a coding round starts.</p></div>';
}

let failed = false;
poll(async () => {
  try {
    const data = await api('/api/me/overview');
    failed = false;
    document.getElementById('stat-total').textContent = data.total;
    document.getElementById('stat-rank').innerHTML = data.rank ? `${ordinal(data.rank)}<span class="muted" style="font-size:.9rem"> / ${data.participants}</span>` : '-';
    document.getElementById('stat-played').textContent = `${data.rounds.filter((r) => r.attempt).length} / ${data.rounds.length}`;
    renderRounds(data.rounds);
    renderRecent(data.recent);
  } catch (err) {
    if (!failed) toast(`Could not refresh: ${err.message}`, 'error');
    failed = true;
  }
}, 15000);
