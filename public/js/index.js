import { api, me, renderNav, poll, esc, avatar, statusBadge, timeOf } from './app.js';

const user = await me();
renderNav(user);

if (user) {
  document.getElementById('hero-cta').innerHTML = user.role === 'admin'
    ? '<a class="btn btn-primary btn-lg" href="/admin.html">Open admin <i class="ph ph-arrow-right" aria-hidden="true"></i></a><a class="btn btn-ghost btn-lg" href="/leaderboard.html">View rankings</a>'
    : '<a class="btn btn-primary btn-lg" href="/dashboard.html">Go to dashboard <i class="ph ph-arrow-right" aria-hidden="true"></i></a><a class="btn btn-ghost btn-lg" href="/leaderboard.html">View rankings</a>';
}

const typeIcon = { quiz: 'ph-list-checks', code: 'ph-code' };

function renderTimeline(rounds) {
  document.getElementById('timeline').innerHTML = rounds.map((r, i) => `
    <li class="reveal ${r.status === 'live' ? 'is-live' : ''}" style="--i:${i}">
      <div class="row" style="gap:8px"><h3>${esc(r.title)}</h3>${statusBadge(r.status)}</div>
      <div class="meta">
        <span><i class="ph ${typeIcon[r.type]}" aria-hidden="true"></i> ${r.type === 'quiz' ? 'Multiple choice' : 'Code'}</span>
        <span><i class="ph ph-timer" aria-hidden="true"></i> ${r.duration_min} min</span>
      </div>
      <p class="muted">${esc(r.about)}</p>
      <p class="meta">${r.qualify_count ? `Top ${r.qualify_count} advance` : 'Decides the winner'}</p>
    </li>`).join('');
}

async function refresh() {
  const board = await api('/api/leaderboard').catch(() => null);
  if (!board) return;
  const live = board.rounds.find((r) => r.status === 'live');
  document.getElementById('live-status').innerHTML = board.published
    ? '<span class="badge badge-ok">Final results</span>'
    : live ? `<span class="badge badge-live">${esc(live.title)}</span>` : '<span class="badge">Not started</span>';
  const top = board.rows.slice(0, 5);
  document.getElementById('live-list').innerHTML = top.length
    ? top.map((r) => `
        <li>
          <span class="rank">${r.rank}</span>
          <span class="person">${avatar(r.name)}<span style="min-width:0"><span class="person-name" style="display:block">${esc(r.name)}</span><span class="person-sub" style="display:block">${esc(r.college || 'Independent')}</span></span></span>
          <span class="total">${r.total}</span>
        </li>`).join('')
    : '<li style="display:block"><div class="empty"><i class="ph ph-trophy" aria-hidden="true"></i><p>No scores yet. Be the first on the board.</p></div></li>';
  document.getElementById('live-count').textContent = `${board.rows.length} participant${board.rows.length === 1 ? '' : 's'}`;
  document.getElementById('live-updated').textContent = `Updated ${timeOf(Date.now())}`;
  if (!document.getElementById('timeline').children.length) renderTimeline(board.rounds);
}

poll(refresh, 15000);
