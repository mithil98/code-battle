import { api, requireUser, renderNav, esc, toast, clock, richText } from './app.js';

const user = await requireUser('participant');
renderNav(user, 'Dashboard');

const roundId = new URLSearchParams(location.search).get('id');
const app = document.getElementById('app');
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  drop(key) { try { localStorage.removeItem(key); } catch {} },
};

let skew = 0;
let deadline = 0;
let onTimeUp = () => {};
let timeUp = false;
const remaining = () => deadline - (Date.now() + skew);

function message(icon, title, text) {
  app.innerHTML = `
    <div class="intro panel panel-pad">
      <div class="empty"><i class="ph ${icon}" aria-hidden="true"></i><h1>${esc(title)}</h1><p>${esc(text)}</p>
      <a class="btn btn-ghost" href="/dashboard.html" style="margin-top:8px">Back to dashboard</a></div>
    </div>`;
}

function startTimer() {
  const bar = document.getElementById('timer');
  const textEl = document.getElementById('timer-text');
  const warned = new Set();
  const tick = () => {
    const left = remaining();
    textEl.textContent = clock(left);
    bar.classList.toggle('low', left <= 60000);
    for (const mark of [300000, 60000]) {
      if (left <= mark && left > mark - 2000 && !warned.has(mark)) {
        warned.add(mark);
        toast(`${mark / 60000} minute${mark > 60000 ? 's' : ''} left`);
      }
    }
    if (left <= 0 && !timeUp) {
      timeUp = true;
      clearInterval(timer);
      onTimeUp();
    }
  };
  const timer = setInterval(tick, 500);
  tick();
}

function showBar(round) {
  document.getElementById('round-bar').hidden = false;
  document.getElementById('round-title').textContent = round.title;
  document.title = `${round.title} · Code Battle`;
}

// ---------- quiz ----------

function renderQuizResult(round, result) {
  app.innerHTML = `
    <div class="intro panel panel-pad stack">
      <h2>Quiz submitted</h2>
      <p class="num" style="font-size:2.4rem;font-weight:700">${result.score}<span class="muted" style="font-size:1.2rem"> / ${round.maxScore}</span></p>
      <p class="muted">${result.correct} of ${result.total} answers correct. Qualifiers are announced when the organizers end the round.</p>
      <div class="row"><a class="btn btn-primary" href="/leaderboard.html">See live rankings</a><a class="btn btn-ghost" href="/dashboard.html">Back to dashboard</a></div>
    </div>`;
}

function runQuiz(data) {
  const { round, questions } = data;
  if (data.finished) return renderQuizResult(round, data.result);
  const key = `cb-quiz-${user.id}-${round.id}`;
  const answers = store.get(key) ?? {};
  let current = 0;
  let submitting = false;

  app.innerHTML = `
    <div class="quiz">
      <aside class="qnav-wrap stack">
        <div class="qnav" id="qnav" aria-label="Questions"></div>
        <p class="muted" id="answered"></p>
        <div id="submit-area"></div>
      </aside>
      <section class="panel panel-pad question" id="question" aria-live="polite"></section>
    </div>`;

  const answeredCount = () => questions.filter((q) => Number.isInteger(answers[q.id])).length;

  function paintNav() {
    document.getElementById('qnav').innerHTML = questions.map((q, i) => `
      <button type="button" class="${Number.isInteger(answers[q.id]) ? 'answered' : ''}" aria-current="${i === current}"
        aria-label="Question ${i + 1}${Number.isInteger(answers[q.id]) ? ', answered' : ''}" data-i="${i}">${i + 1}</button>`).join('');
    document.getElementById('answered').textContent = `${answeredCount()} of ${questions.length} answered`;
    document.getElementById('progress').textContent = `${answeredCount()}/${questions.length}`;
  }

  function paintQuestion() {
    const q = questions[current];
    document.getElementById('question').innerHTML = `
      <fieldset>
        <legend>${current + 1}. ${esc(q.title)}</legend>
        ${q.body ? `<div class="muted" style="margin:-6px 0 8px">${richText(q.body)}</div>` : ''}
        ${q.options.map((o, i) => `
          <label class="option"><input type="radio" name="q${q.id}" value="${i}" ${answers[q.id] === i ? 'checked' : ''} ${timeUp ? 'disabled' : ''}><span>${esc(o)}</span></label>`).join('')}
      </fieldset>
      <div class="spread" style="margin-top:20px">
        <button class="btn btn-ghost" type="button" id="prev" ${current === 0 ? 'disabled' : ''}><i class="ph ph-arrow-left" aria-hidden="true"></i> Previous</button>
        <span class="muted num">${q.points} pts</span>
        <button class="btn btn-ghost" type="button" id="next" ${current === questions.length - 1 ? 'disabled' : ''}>Next <i class="ph ph-arrow-right" aria-hidden="true"></i></button>
      </div>`;
  }

  function paintSubmit(confirming = false) {
    const area = document.getElementById('submit-area');
    const left = questions.length - answeredCount();
    area.innerHTML = confirming
      ? `<div class="panel panel-pad stack" style="padding:16px">
           <p>${left ? `${left} question${left === 1 ? ' is' : 's are'} unanswered.` : 'All questions answered.'} You cannot change answers after submitting.</p>
           <button class="btn btn-primary" type="button" id="confirm-submit">Submit now</button>
           <button class="btn btn-ghost" type="button" id="cancel-submit">Keep working</button>
         </div>`
      : '<button class="btn btn-primary" type="button" id="submit-quiz" style="width:100%">Submit quiz</button>';
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    document.querySelectorAll('#submit-area button').forEach((b) => { b.disabled = true; });
    try {
      const result = await api(`/api/rounds/${round.id}/quiz`, { method: 'POST', body: { answers } });
      store.drop(key);
      renderQuizResult(round, result);
    } catch (err) {
      submitting = false;
      toast(err.message, 'error');
      if (err.status === 409 || err.status === 403) setTimeout(() => location.reload(), 1500);
      else paintSubmit();
    }
  }

  app.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.i) { current = Number(t.dataset.i); paintNav(); paintQuestion(); }
    else if (t.id === 'prev') { current--; paintNav(); paintQuestion(); }
    else if (t.id === 'next') { current++; paintNav(); paintQuestion(); }
    else if (t.id === 'submit-quiz') { paintSubmit(true); document.getElementById('confirm-submit').focus(); }
    else if (t.id === 'cancel-submit') paintSubmit();
    else if (t.id === 'confirm-submit') submit();
  });
  app.addEventListener('change', (e) => {
    if (e.target.type !== 'radio') return;
    answers[questions[current].id] = Number(e.target.value);
    store.set(key, answers);
    paintNav();
  });

  onTimeUp = () => {
    toast('Time is up. Submitting your answers.');
    paintQuestion();
    submit();
  };
  paintNav();
  paintQuestion();
  paintSubmit();
  startTimer();
}

// ---------- code ----------

const MODES = { python: 'python', javascript: 'javascript', cpp: 'text/x-c++src', java: 'text/x-java' };

function runCoder(data) {
  const { round, questions, languages } = data;
  const closed = data.finished || round.status === 'ended' || remaining() <= 0;
  let current = 0;
  let lang;
  let busy = false;

  if (!questions.length) return message('ph-hourglass', 'No problems yet', 'The organizers have not added problems to this round yet.');

  app.innerHTML = `
    <div id="closed-banner"></div>
    <div class="coder">
      <nav class="qlist" id="qlist" aria-label="Problems"></nav>
      <div class="stack" style="min-width:0">
        <label class="qselect"><span class="visually-hidden">Problem</span><select id="qselect"></select></label>
        <div class="tabs pane-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected="true" data-pane="problem">Problem</button>
          <button type="button" role="tab" aria-selected="false" data-pane="code">Code</button>
        </div>
        <div class="coder-panes">
          <section class="panel panel-pad problem" id="pane-problem"></section>
          <section class="editor-wrap" id="pane-code" hidden>
            <div class="editor-tools">
              <label class="visually-hidden" for="lang">Language</label>
              <select id="lang"></select>
              <button class="btn btn-ghost btn-sm" type="button" id="reset">Reset code</button>
              <button class="btn btn-primary" type="button" id="submit" style="margin-left:auto"><i class="ph ph-play" aria-hidden="true"></i> Submit</button>
            </div>
            <div class="editor-box" id="editor"></div>
            <div class="results" id="results" aria-live="polite"></div>
          </section>
        </div>
      </div>
    </div>`;

  const host = document.getElementById('editor');
  let editor;
  if (window.CodeMirror) {
    editor = window.CodeMirror(host, {
      lineNumbers: true, indentUnit: 4, tabSize: 4, matchBrackets: true, autoCloseBrackets: true,
      extraKeys: { Tab: (cm) => cm.replaceSelection('    '), 'Ctrl-Enter': () => submit(), 'Cmd-Enter': () => submit() },
    });
  } else {
    const ta = Object.assign(document.createElement('textarea'), { spellcheck: false });
    ta.setAttribute('aria-label', 'Code editor');
    host.append(ta);
    editor = {
      getValue: () => ta.value, setValue: (v) => { ta.value = v; }, setOption: (k, v) => { if (k === 'readOnly') ta.readOnly = v; },
      on: (_, fn) => ta.addEventListener('input', fn), refresh() {},
    };
  }

  const draftKey = (q, l) => `cb-code-${user.id}-${q.id}-${l}`;
  const saveDraft = () => { if (lang && !closed) store.set(draftKey(questions[current], lang), editor.getValue()); };
  let saveTimer;
  editor.on('change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 400); });

  function initialCode(q, l) {
    return store.get(draftKey(q, l)) ?? (q.last?.language === l ? q.last.code : q.starter[l] ?? '');
  }

  function paintList() {
    const label = (q) => `${q.best ?? 0}/${q.points}`;
    document.getElementById('qlist').innerHTML = questions.map((q, i) => `
      <button type="button" data-q="${i}" aria-current="${i === current}"><span>${esc(q.title)}</span><small>${label(q)} pts</small></button>`).join('');
    document.getElementById('qselect').innerHTML = questions.map((q, i) =>
      `<option value="${i}" ${i === current ? 'selected' : ''}>${i + 1}. ${esc(q.title)} (${label(q)})</option>`).join('');
    const solved = questions.filter((q) => q.best === q.points).length;
    document.getElementById('progress').textContent = `${solved}/${questions.length} solved`;
  }

  function paintProblem() {
    const q = questions[current];
    document.getElementById('pane-problem').innerHTML = `
      <div class="spread"><h2>${esc(q.title)}</h2><span class="badge ${q.best === q.points ? 'badge-ok' : ''}">${q.best ?? 0} / ${q.points} pts</span></div>
      <div class="body">${richText(q.body)}</div>
      ${q.samples.map((s, i) => `
        <div>
          <h3 style="font-size:.9rem">Sample ${i + 1}</h3>
          <div class="sample"><div><span class="label muted">Input</span><pre>${esc(s.input)}</pre></div><div><span class="label muted">Output</span><pre>${esc(s.output)}</pre></div></div>
        </div>`).join('')}
      <p class="muted" style="font-size:.85rem">Plus ${q.hiddenCount} hidden test${q.hiddenCount === 1 ? '' : 's'}. Read from standard input and print to standard output.</p>`;
  }

  function loadQuestion(i) {
    saveDraft();
    current = i;
    const q = questions[current];
    const saved = store.get(`cb-lang-${user.id}-${q.id}`);
    lang = q.languages.includes(saved) ? saved : q.last?.language && q.languages.includes(q.last.language) ? q.last.language : q.languages[0];
    document.getElementById('lang').innerHTML = q.languages.map((l) => `<option value="${l}" ${l === lang ? 'selected' : ''}>${esc(languages[l] ?? l)}</option>`).join('');
    editor.setOption?.('mode', MODES[lang]);
    editor.setValue(initialCode(q, lang));
    document.getElementById('results').innerHTML = '';
    paintList();
    paintProblem();
  }

  function renderResults(res) {
    document.getElementById('results').innerHTML = `
      <div class="banner" style="background:${res.passed === res.total ? 'var(--success-soft)' : 'var(--surface-2)'};color:${res.passed === res.total ? 'var(--success)' : 'var(--text)'}">
        <i class="ph ${res.passed === res.total ? 'ph-check-circle' : 'ph-info'}" aria-hidden="true"></i>
        Passed ${res.passed} of ${res.total} tests. Score ${res.score}, best ${res.best}.
      </div>
      ${res.results.map((r, i) => `
        <div class="result">
          <div class="spread"><strong>${r.hidden ? 'Hidden test' : 'Sample test'} ${i + 1}</strong>
            <span class="badge ${r.ok ? 'badge-ok' : 'badge-bad'}">${r.ok ? 'Passed' : esc(r.error || 'Failed')}</span></div>
          ${!r.hidden && !r.ok ? `
            <div class="result-grid">
              <div><span class="label muted">Input</span><pre>${esc(r.input)}</pre></div>
              <div><span class="label muted">Expected</span><pre>${esc(r.expected)}</pre></div>
              <div><span class="label muted">Your output</span><pre>${esc(r.got ?? '')}</pre></div>
            </div>
            ${r.detail ? `<pre style="color:var(--danger)">${esc(r.detail)}</pre>` : ''}` : ''}
        </div>`).join('')}`;
  }

  async function submit() {
    if (busy || closed || timeUp) return;
    const button = document.getElementById('submit');
    busy = true;
    button.disabled = true;
    button.innerHTML = '<i class="ph ph-hourglass" aria-hidden="true"></i> Running tests…';
    document.getElementById('results').innerHTML = '<div class="result stack" style="gap:8px"><span class="skeleton" style="width:60%"></span><span class="skeleton" style="width:40%"></span></div>';
    const q = questions[current];
    try {
      const res = await api(`/api/questions/${q.id}/submit`, { method: 'POST', body: { language: lang, code: editor.getValue() } });
      q.best = res.best;
      q.last = { language: lang, code: editor.getValue() };
      renderResults(res);
      paintList();
      paintProblem();
    } catch (err) {
      document.getElementById('results').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
    } finally {
      busy = false;
      button.disabled = timeUp;
      button.innerHTML = '<i class="ph ph-play" aria-hidden="true"></i> Submit';
    }
  }

  function lock(text) {
    editor.setOption('readOnly', true);
    document.getElementById('submit').disabled = true;
    document.getElementById('reset').disabled = true;
    document.getElementById('closed-banner').innerHTML = `<div class="banner" style="margin-top:16px"><i class="ph ph-lock" aria-hidden="true"></i>${esc(text)}</div>`;
  }

  app.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.q) loadQuestion(Number(t.dataset.q));
    else if (t.dataset.pane) {
      document.querySelectorAll('.pane-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
      document.getElementById('pane-problem').hidden = t.dataset.pane !== 'problem';
      document.getElementById('pane-code').hidden = t.dataset.pane !== 'code';
      editor.refresh();
    } else if (t.id === 'reset') {
      const q = questions[current];
      store.drop(draftKey(q, lang));
      editor.setValue(q.starter[lang] ?? '');
    } else if (t.id === 'submit') submit();
  });
  document.getElementById('qselect').addEventListener('change', (e) => loadQuestion(Number(e.target.value)));
  document.getElementById('lang').addEventListener('change', (e) => {
    saveDraft();
    lang = e.target.value;
    store.set(`cb-lang-${user.id}-${questions[current].id}`, lang);
    editor.setOption?.('mode', MODES[lang]);
    editor.setValue(initialCode(questions[current], lang));
  });

  loadQuestion(0);
  if (closed) {
    timeUp = true;
    document.getElementById('timer-text').textContent = '00:00';
    lock(round.status === 'ended' ? 'This round has ended. You can review your code.' : 'Time is up. You can review your code.');
  } else {
    onTimeUp = () => { toast('Time is up'); lock('Time is up. Your best score per problem has been saved.'); };
    startTimer();
  }
}

// ---------- entry ----------

async function begin() {
  app.innerHTML = '<div class="intro panel panel-pad stack"><span class="skeleton" style="width:50%;height:28px"></span><span class="skeleton"></span></div>';
  try {
    const data = await api(`/api/rounds/${roundId}/start`, { method: 'POST' });
    skew = data.now - Date.now();
    deadline = data.deadline;
    showBar(data.round);
    if (data.round.type === 'quiz') runQuiz(data);
    else runCoder(data);
  } catch (err) {
    message('ph-lock', 'Cannot open this round', err.message);
  }
}

function intro(round) {
  const rules = round.type === 'quiz'
    ? ['You submit once. Unanswered questions score zero.', 'The quiz submits itself when time runs out.', 'Your answers are kept if you refresh the page.']
    : ['Submit as often as you like before time runs out.', 'Your best score on each problem counts.', 'Hidden tests decide your score, samples help you check.'];
  app.innerHTML = `
    <div class="intro panel panel-pad stack">
      <h1>${esc(round.title)}</h1>
      <p class="muted">${esc(round.about)}</p>
      <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="stat"><span class="label">Time</span><span class="value">${round.duration_min}m</span></div>
        <div class="stat"><span class="label">${round.type === 'quiz' ? 'Questions' : 'Problems'}</span><span class="value">${round.questionCount}</span></div>
        <div class="stat"><span class="label">Max points</span><span class="value">${round.maxScore}</span></div>
      </div>
      <ul>${rules.map((r) => `<li>${r}</li>`).join('')}<li>The timer starts when you press Start and keeps running if you leave.</li></ul>
      <div class="row"><button class="btn btn-primary btn-lg" type="button" id="start">Start round</button><a class="btn btn-ghost btn-lg" href="/dashboard.html">Not yet</a></div>
    </div>`;
  document.getElementById('start').onclick = begin;
}

try {
  const round = await api(`/api/rounds/${roundId}`);
  if (round.attempt) begin();
  else if (round.canEnter) intro(round);
  else if (round.eliminated) message('ph-flag', 'You did not qualify', 'Thanks for battling. Follow the live rankings to see who wins.');
  else if (!round.qualified) message('ph-lock', 'Locked', 'Qualify in the previous round to unlock this one.');
  else message('ph-hourglass', `${round.title} is not live`, round.status === 'ended' ? 'This round has ended.' : 'The organizers will start it soon. Your dashboard updates on its own.');
} catch (err) {
  message('ph-warning', 'Round not found', err.message);
}
