import { api, requireUser, renderNav, poll, esc, toast, timeOf, statusBadge } from './app.js';

const user = await requireUser('admin');
renderNav(user, 'Admin');

const LANGS = { python: 'Python', javascript: 'JavaScript', cpp: 'C++', java: 'Java' };
let rounds = [];
const tabs = {};

// Two-step confirm without browser dialogs: first click arms the button, second click runs.
function armed(btn, label = 'Click again to confirm') {
  if (btn.dataset.armed) return true;
  const original = btn.innerHTML;
  btn.dataset.armed = '1';
  btn.textContent = label;
  setTimeout(() => { delete btn.dataset.armed; btn.innerHTML = original; }, 4000);
  return false;
}

const roundOptions = (selected, filter = () => true) =>
  rounds.filter(filter).map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${r.seq}. ${esc(r.title)}</option>`).join('');

async function loadRounds() { rounds = await api('/api/admin/rounds'); }

// ---------- rounds ----------

tabs.rounds = async (el) => {
  await loadRounds();
  el.innerHTML = `
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Round</th><th>Status</th><th>Minutes</th><th>Qualify top</th><th class="num">Questions</th><th class="num">Started</th><th class="num">Qualified in</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${rounds.map((r) => `
        <tr data-id="${r.id}">
          <td><div class="person-name">${r.seq}. ${esc(r.title)}</div><div class="person-sub">${r.type === 'quiz' ? 'Quiz' : 'Code'} ${statusBadge(r.status)}</div></td>
          <td><select name="status" aria-label="Status of ${esc(r.title)}" style="min-width:120px">
            ${['upcoming', 'live', 'ended'].map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
          </select></td>
          <td><input class="cell-input" type="number" name="duration_min" min="1" max="600" value="${r.duration_min}" aria-label="Minutes for ${esc(r.title)}"></td>
          <td><input class="cell-input" type="number" name="qualify_count" min="1" value="${r.qualify_count ?? ''}" placeholder="None" aria-label="Qualify count for ${esc(r.title)}"></td>
          <td class="num">${r.questions}</td><td class="num">${r.attempts}</td><td class="num">${r.seq === 1 ? 'All' : r.qualified}</td>
          <td><div class="row" style="flex-wrap:nowrap">
            <button class="btn btn-ghost btn-sm" type="button" data-act="save">Save</button>
            <button class="btn ${r.status === 'live' ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" data-act="qualify" ${r.status === 'ended' ? 'disabled' : ''}>End and qualify</button>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div></div>
    <p class="muted" style="font-size:.88rem">Set a round to Live to let qualified participants start it. End and qualify closes the round and moves its top scorers (ties at the cut-off included) into the next round.</p>`;
  el.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('tr');
    const id = row.dataset.id;
    try {
      if (btn.dataset.act === 'save') {
        const body = Object.fromEntries([...row.querySelectorAll('select, input')].map((i) => [i.name, i.value === '' ? null : i.value]));
        await api(`/api/admin/rounds/${id}`, { method: 'PATCH', body });
        toast('Round saved');
      } else {
        if (!armed(btn, 'Confirm end')) return;
        const res = await api(`/api/admin/rounds/${id}/qualify`, { method: 'POST' });
        toast(res.next ? `${res.qualified} qualified for ${res.next.title}` : 'Round ended');
      }
      tabs.rounds(el);
    } catch (err) { toast(err.message, 'error'); }
  };
};

// ---------- questions ----------

let qRound = null;
let questions = [];
const dialog = document.getElementById('q-dialog');
const qForm = document.getElementById('q-form');
let editing = null;

function questionFields(round, q = {}) {
  const common = `
    <div class="field"><label for="f-title">${round.type === 'quiz' ? 'Question' : 'Title'}</label><input id="f-title" name="title" type="text" required maxlength="300" value="${esc(q.title ?? '')}"></div>
    <div class="field"><label for="f-body">${round.type === 'quiz' ? 'Extra details (optional)' : 'Problem statement'}</label>
      <textarea id="f-body" name="body" rows="${round.type === 'quiz' ? 2 : 6}" style="font-family:var(--font);font-size:.92rem">${esc(q.body ?? '')}</textarea>
      <span class="hint">Wrap code in backticks. Leave a blank line between paragraphs.</span></div>
    <div class="field" style="max-width:160px"><label for="f-points">Points</label><input id="f-points" name="points" type="number" min="1" max="1000" required value="${q.points ?? (round.type === 'quiz' ? 10 : 100)}"></div>`;
  if (round.type === 'quiz') {
    return common + `
      <div class="field"><label for="f-options">Options, one per line</label><textarea id="f-options" name="options" rows="4">${esc((q.options ?? []).join('\n'))}</textarea></div>
      <div class="field" style="max-width:200px"><label for="f-answer">Correct option number</label><input id="f-answer" name="answer" type="number" min="1" max="6" required value="${q.answer != null ? q.answer + 1 : 1}"></div>`;
  }
  return common + `
    <div class="starter-grid">${Object.entries(LANGS).map(([id, label]) => `
      <div class="field"><label for="f-starter-${id}">Starter code: ${label}</label>
        <textarea id="f-starter-${id}" name="starter-${id}" rows="6" spellcheck="false">${esc(q.starter?.[id] ?? '')}</textarea>
        <span class="hint">Leave empty to disallow ${label}.</span></div>`).join('')}</div>
    <div class="field"><label for="f-tests">Test cases (JSON)</label>
      <textarea id="f-tests" name="tests" rows="8" spellcheck="false">${esc(JSON.stringify(q.tests ?? [{ input: '', output: '', hidden: false }], null, 2))}</textarea>
      <span class="hint">Array of {"input", "output", "hidden"}. Hidden tests are never shown to participants.</span></div>`;
}

function openEditor(q = null) {
  const round = rounds.find((r) => r.id === qRound);
  editing = q;
  document.getElementById('q-dialog-title').textContent = q ? 'Edit question' : `New question for ${round.title}`;
  document.getElementById('q-fields').innerHTML = questionFields(round, q ?? {});
  qForm.querySelector('.form-error').hidden = true;
  dialog.showModal();
}

dialog.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dialog.close(); });
qForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const round = rounds.find((r) => r.id === qRound);
  const f = new FormData(qForm);
  const errorBox = qForm.querySelector('.form-error');
  const body = { round_id: qRound, title: f.get('title'), body: f.get('body'), points: f.get('points') };
  try {
    if (round.type === 'quiz') {
      body.options = String(f.get('options')).split('\n').map((s) => s.trim()).filter(Boolean);
      body.answer = Number(f.get('answer')) - 1;
    } else {
      body.starter = Object.fromEntries(Object.keys(LANGS).map((id) => [id, f.get(`starter-${id}`)]));
      try { body.tests = JSON.parse(f.get('tests')); } catch { throw new Error('Test cases are not valid JSON'); }
    }
    await api(editing ? `/api/admin/questions/${editing.id}` : '/api/admin/questions', { method: editing ? 'PUT' : 'POST', body });
    dialog.close();
    toast('Question saved');
    tabs.questions(document.getElementById('tab-questions'));
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

tabs.questions = async (el) => {
  if (!rounds.length) await loadRounds();
  qRound ??= rounds[0].id;
  questions = await api(`/api/admin/questions?round=${qRound}`);
  const round = rounds.find((r) => r.id === qRound);
  el.innerHTML = `
    <div class="panel panel-pad" style="padding:16px 20px">
      <div class="inline-form">
        <div class="field"><label for="q-round">Round</label><select id="q-round">${roundOptions(qRound)}</select></div>
        <button class="btn btn-primary" type="button" id="q-add"><i class="ph ph-plus" aria-hidden="true"></i> Add question</button>
      </div>
    </div>
    ${round.type === 'quiz' ? `
    <div class="panel panel-pad" style="padding:16px 20px">
      <div class="inline-form">
        <div class="field" style="min-width:220px;flex:1"><span class="label">Import from Open Trivia DB</span><span class="hint">Free computer science questions, no key needed.</span></div>
        <div class="field"><label for="t-amount">How many</label><input id="t-amount" type="number" min="1" max="30" value="10" class="cell-input" style="min-height:42px"></div>
        <div class="field"><label for="t-diff">Difficulty</label><select id="t-diff"><option value="">Any</option><option>easy</option><option>medium</option><option>hard</option></select></div>
        <button class="btn btn-ghost" type="button" id="t-import"><i class="ph ph-download-simple" aria-hidden="true"></i> Import</button>
      </div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-head"><h2>${esc(round.title)}</h2><span class="muted">${questions.length} question${questions.length === 1 ? '' : 's'}, ${questions.reduce((s, q) => s + q.points, 0)} points</span></div>
      ${questions.length ? questions.map((q) => `
        <div class="q-item" data-id="${q.id}">
          <div style="min-width:0"><div class="person-name" style="white-space:normal">${esc(q.title)}</div>
            <div class="person-sub">${q.points} pts, ${q.options ? `${q.options.length} options` : `${q.tests.length} tests (${q.tests.filter((t) => t.hidden).length} hidden), ${Object.keys(q.starter).map((l) => LANGS[l]).join(', ')}`}</div></div>
          <div class="row" style="flex-wrap:nowrap">
            <button class="btn btn-ghost btn-sm" type="button" data-act="edit">Edit</button>
            <button class="btn btn-danger btn-sm" type="button" data-act="delete">Delete</button>
          </div>
        </div>`).join('') : '<div class="empty"><i class="ph ph-question" aria-hidden="true"></i><p>No questions yet. Add one or import from Open Trivia DB.</p></div>'}
    </div>`;
  el.querySelector('#q-round').onchange = (e) => { qRound = Number(e.target.value); tabs.questions(el); };
  el.querySelector('#q-add').onclick = () => openEditor();
  el.querySelector('#t-import')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api('/api/admin/import-trivia', { method: 'POST', body: { round_id: qRound, amount: Number(el.querySelector('#t-amount').value), difficulty: el.querySelector('#t-diff').value } });
      toast(`Imported ${res.imported} questions`);
      tabs.questions(el);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
  el.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const q = questions.find((x) => x.id === Number(btn.closest('.q-item').dataset.id));
    if (btn.dataset.act === 'edit') return openEditor(q);
    if (!armed(btn, 'Confirm delete')) return;
    try {
      await api(`/api/admin/questions/${q.id}`, { method: 'DELETE' });
      toast('Question deleted');
      tabs.questions(el);
    } catch (err) { toast(err.message, 'error'); }
  };
};

// ---------- submissions ----------

let sRound = null;
tabs.submissions = async (el) => {
  if (!rounds.length) await loadRounds();
  sRound ??= (rounds.find((r) => r.status === 'live') ?? rounds[0]).id;
  const subs = await api(`/api/admin/submissions?round=${sRound}`);
  const isQuiz = rounds.find((r) => r.id === sRound).type === 'quiz';
  el.innerHTML = `
    <div class="panel panel-pad" style="padding:16px 20px">
      <div class="inline-form">
        <div class="field"><label for="s-round">Round</label><select id="s-round">${roundOptions(sRound)}</select></div>
        <div class="field" style="flex:1;min-width:200px"><label for="s-search">Filter</label><input id="s-search" type="search" autocomplete="off" placeholder="Participant or question"></div>
        <button class="btn btn-ghost" type="button" id="s-refresh"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Refresh</button>
      </div>
    </div>
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Participant</th><th>Question</th><th>${isQuiz ? 'Answer' : 'Language'}</th><th class="num">Tests</th><th>Score</th><th><span class="visually-hidden">Code</span></th></tr></thead>
      <tbody id="s-body">${subs.length ? subs.map((s) => `
        <tr data-id="${s.id}" data-search="${esc(`${s.name} ${s.email} ${s.question}`.toLowerCase())}">
          <td class="num" style="text-align:left">${timeOf(s.created_at)}</td>
          <td><div class="person-name">${esc(s.name)}</div><div class="person-sub">${esc(s.email)}</div></td>
          <td style="min-width:200px;max-width:320px">${esc(s.question)}</td>
          <td>${isQuiz ? (s.code === '' ? '<span class="muted">Skipped</span>' : `Option ${Number(s.code) + 1}`) : esc(LANGS[s.language] ?? s.language)}</td>
          <td class="num"><span class="badge ${s.passed === s.total ? 'badge-ok' : s.passed ? 'badge-warn' : 'badge-bad'}">${s.passed}/${s.total}</span></td>
          <td><div class="row" style="flex-wrap:nowrap;gap:6px">
            <input class="cell-input" type="number" min="0" max="${s.points}" value="${s.score}" aria-label="Score for ${esc(s.name)}">
            <span class="muted num">/ ${s.points}</span>
            <button class="btn btn-ghost btn-sm" type="button" data-act="score">Save</button>
            ${s.overridden ? '<span class="badge badge-warn">Edited</span>' : ''}
          </div></td>
          <td>${isQuiz ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-act="code">View code</button>'}</td>
        </tr>
        <tr hidden data-code-for="${s.id}"><td colspan="7"><pre class="code-view">${esc(s.code)}</pre></td></tr>`).join('')
      : '<tr><td colspan="7"><div class="empty"><i class="ph ph-tray" aria-hidden="true"></i><p>No submissions for this round yet.</p></div></td></tr>'}</tbody>
    </table></div></div>`;
  el.querySelector('#s-round').onchange = (e) => { sRound = Number(e.target.value); tabs.submissions(el); };
  el.querySelector('#s-refresh').onclick = () => tabs.submissions(el);
  el.querySelector('#s-search').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('tr[data-search]').forEach((tr) => {
      tr.hidden = !!q && !tr.dataset.search.includes(q);
      el.querySelector(`tr[data-code-for="${tr.dataset.id}"]`).hidden = true;
    });
  };
  el.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('tr');
    if (btn.dataset.act === 'code') {
      const codeRow = el.querySelector(`tr[data-code-for="${row.dataset.id}"]`);
      codeRow.hidden = !codeRow.hidden;
      btn.textContent = codeRow.hidden ? 'View code' : 'Hide code';
      return;
    }
    try {
      await api(`/api/admin/submissions/${row.dataset.id}`, { method: 'PATCH', body: { score: Number(row.querySelector('input').value) } });
      toast('Score updated');
    } catch (err) { toast(err.message, 'error'); }
  };
};

// ---------- participants ----------

tabs.participants = async (el) => {
  const users = await api('/api/admin/users');
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Participants</h2><span class="muted">${users.length} registered</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Rank</th><th>Participant</th><th>College</th><th>Joined</th><th class="num">Total</th></tr></thead>
        <tbody>${users.length ? [...users].sort((a, b) => a.rank - b.rank).map((u) => `
          <tr><td class="num" style="text-align:left">${u.rank ?? '-'}</td>
            <td><div class="person-name">${esc(u.name)}</div><div class="person-sub">${esc(u.email)}</div></td>
            <td class="muted">${esc(u.college || '-')}</td>
            <td class="muted">${new Date(u.created_at).toLocaleString()}</td>
            <td class="num" style="font-weight:600">${u.total}</td></tr>`).join('')
        : '<tr><td colspan="5"><div class="empty"><i class="ph ph-users" aria-hidden="true"></i><p>Nobody has registered yet. Share the portal link.</p></div></td></tr>'}</tbody>
      </table></div>
    </div>`;
};

// ---------- results ----------

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

tabs.results = async (el) => {
  const board = await api('/api/leaderboard');
  el.innerHTML = `
    <div class="panel panel-pad stack">
      <div class="spread"><h2>Final results</h2>${board.published ? '<span class="badge badge-ok">Published</span>' : '<span class="badge">Not published</span>'}</div>
      <p class="muted">${board.published
        ? 'Participants now see Final results with the podium on the leaderboard.'
        : 'Publishing switches the leaderboard from Live rankings to Final results with a podium. You can unpublish later.'}</p>
      <div class="row">
        <button class="btn ${board.published ? 'btn-ghost' : 'btn-primary'}" type="button" id="publish">${board.published ? 'Unpublish results' : 'Publish results'}</button>
        <a class="btn btn-ghost" href="/leaderboard.html" target="_blank" rel="noopener">Open leaderboard</a>
        <button class="btn btn-ghost" type="button" id="csv"><i class="ph ph-file-csv" aria-hidden="true"></i> Download CSV</button>
      </div>
    </div>`;
  el.querySelector('#publish').onclick = async (e) => {
    if (!armed(e.currentTarget)) return;
    try {
      await api('/api/admin/publish', { method: 'POST', body: { published: !board.published } });
      toast(board.published ? 'Results unpublished' : 'Results published');
      tabs.results(el);
    } catch (err) { toast(err.message, 'error'); }
  };
  el.querySelector('#csv').onclick = () => {
    const header = ['Rank', 'Name', 'College', ...board.rounds.map((r) => r.title), 'Total'];
    const lines = board.rows.map((r) => [r.rank, r.name, r.college, ...board.rounds.map((x) => r.scores[x.id] ?? 0), r.total]);
    const csv = [header, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'code-battle-results.csv' });
    a.click();
    URL.revokeObjectURL(a.href);
  };
};

// ---------- shell ----------

const tabButtons = document.querySelectorAll('[data-tab]');
async function open(name) {
  tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  for (const b of tabButtons) document.getElementById(`tab-${b.dataset.tab}`).hidden = b.dataset.tab !== name;
  const el = document.getElementById(`tab-${name}`);
  el.innerHTML = '<div class="panel panel-pad stack"><span class="skeleton" style="width:40%"></span><span class="skeleton"></span><span class="skeleton" style="width:70%"></span></div>';
  try { await tabs[name](el); } catch (err) { el.innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
}
tabButtons.forEach((b) => { b.onclick = () => { history.replaceState(null, '', `#${b.dataset.tab}`); open(b.dataset.tab); }; });
open(tabs[location.hash.slice(1)] ? location.hash.slice(1) : 'rounds');

poll(async () => {
  const s = await api('/api/admin/runner').catch(() => ({ online: false, languages: [] }));
  document.getElementById('runner').innerHTML = s.online
    ? `<span class="badge badge-ok" title="${esc(s.languages.join(', '))}">Code runner online, ${s.languages.length} languages</span>`
    : '<span class="badge badge-bad">Code runner offline</span>';
}, 30000);
