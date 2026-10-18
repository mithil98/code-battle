import { api, me, renderNav, poll, esc, avatar, timeOf } from './app.js';

const user = await me();
renderNav(user, 'Leaderboard');

let board = null;
const search = document.getElementById('search');
const short = { 1: 'Quiz', 2: 'Code', 3: 'Debug', 4: 'Final' };

function renderPodium(rows) {
  const spot = (r, place, cls = '') => r ? `
    <div class="podium-spot ${cls}">
      <span class="place">${place}</span>
      ${avatar(r.name, 'avatar-lg')}
      <span class="person-name">${esc(r.name)}</span>
      <span class="person-sub">${esc(r.college || 'Independent')}</span>
      <span class="num" style="font-weight:700;font-size:1.1rem">${r.total}</span>
    </div>` : '<div></div>';
  document.getElementById('podium').innerHTML = board.published && rows.length
    ? `<div class="podium" aria-label="Top three">${spot(rows[1], 2)}${spot(rows[0], 1, 'first')}${spot(rows[2], 3)}</div>`
    : '';
}

function render() {
  if (!board) return;
  const q = search.value.trim().toLowerCase();
  const rows = board.rows.filter((r) => !q || r.name.toLowerCase().includes(q) || r.college.toLowerCase().includes(q));
  document.getElementById('thead').innerHTML = `
    <tr><th>Rank</th><th>Participant</th><th class="col-college">College</th>
    ${board.rounds.map((r) => `<th class="num col-round" title="${esc(r.title)}">${esc(short[r.seq] ?? r.title)}</th>`).join('')}
    <th class="num">Total</th></tr>`;
  document.getElementById('tbody').innerHTML = rows.length
    ? rows.map((r) => `
      <tr class="${user && r.userId === user.id ? 'me' : ''}">
        <td class="num" style="text-align:left;font-weight:600">${r.rank}</td>
        <td>
          <div class="person">${avatar(r.name)}<div style="min-width:0">
            <div class="person-name">${esc(r.name)}${user && r.userId === user.id ? ' <span class="badge badge-live" style="margin-left:4px">You</span>' : ''}</div>
            <div class="mobile-breakdown">${board.rounds.map((x) => `<span>${short[x.seq] ?? esc(x.title)} ${r.scores[x.id] ?? 0}</span>`).join('')}</div>
          </div></div>
        </td>
        <td class="col-college muted">${esc(r.college || '-')}</td>
        ${board.rounds.map((x) => `<td class="num col-round">${r.scores[x.id] ?? '<span class="muted">0</span>'}</td>`).join('')}
        <td class="num" style="font-weight:700">${r.total}</td>
      </tr>`).join('')
    : `<tr><td colspan="${board.rounds.length + 4}"><div class="empty"><i class="ph ph-users-three" aria-hidden="true"></i><p>${q ? 'Nobody matches that search.' : 'No participants yet.'}</p></div></td></tr>`;
  document.getElementById('count').textContent = `${rows.length} of ${board.rows.length}`;
}

let timer;
async function refresh() {
  const data = await api('/api/leaderboard').catch(() => null);
  if (!data) return;
  board = data;
  const live = board.rounds.find((r) => r.status === 'live');
  document.getElementById('board-title').textContent = board.published ? 'Final results' : 'Live rankings';
  document.getElementById('board-status').innerHTML = board.published
    ? '<span class="badge badge-ok">Published</span>'
    : live ? `<span class="badge badge-live">${esc(live.title)} live</span>` : '';
  document.getElementById('board-sub').textContent = board.published
    ? 'The organizers have published the final standings.'
    : `Scores update every 10 seconds. Last updated ${timeOf(Date.now())}.`;
  renderPodium(board.rows);
  render();
}

search.addEventListener('input', render);
poll(refresh, 10000);
