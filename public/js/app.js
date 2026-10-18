// Shared browser helpers for every page.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const me = () => api('/api/me').catch(() => null);

const never = () => new Promise(() => {});

export async function requireUser(role) {
  const user = await me();
  if (!user) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return never();
  }
  if (role && user.role !== role) {
    location.href = user.role === 'admin' ? '/admin.html' : '/dashboard.html';
    return never();
  }
  return user;
}

// DiceBear initials avatars: free, no key. https://www.dicebear.com/styles/initials/
export const avatarUrl = (name) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=3f6212,1f2a2e,2b3440,33402a,3a2f2a&textColor=eceee9&fontWeight=600`;

export const avatar = (name, size = '') =>
  `<img class="avatar ${size}" src="${avatarUrl(name)}" alt="" width="32" height="32" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;

const effectiveTheme = () =>
  document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function renderNav(user, active = '') {
  const links = [
    ['Dashboard', '/dashboard.html', user?.role === 'participant'],
    ['Leaderboard', '/leaderboard.html', true],
    ['Admin', '/admin.html', user?.role === 'admin'],
  ].filter((l) => l[2]);
  const nav = document.getElementById('nav');
  const main = document.querySelector('main');
  main.id ||= 'main';
  main.tabIndex = -1;
  nav.innerHTML = `
    <a class="skip" href="#${main.id}">Skip to content</a>
    <div class="wrap topbar-inner">
      <a class="brand" href="/" translate="no"><i class="ph ph-sword" aria-hidden="true"></i><span>Code Battle</span></a>
      <button class="icon-btn menu-btn" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Open menu"><i class="ph ph-list" aria-hidden="true"></i></button>
      <nav id="nav-links" class="nav-links" aria-label="Main">
        ${links.map(([label, href]) => `<a href="${href}"${active === label ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        <button class="icon-btn theme-btn" type="button" aria-label="Switch color theme"><i class="ph" aria-hidden="true"></i></button>
        ${user
          ? `<span class="nav-user">${avatar(user.name, 'avatar-sm')}<span>${esc(user.name)}</span></span>
             <button class="btn btn-ghost btn-sm logout-btn" type="button">Log out</button>`
          : `<a class="btn btn-ghost btn-sm" href="/login.html">Log in</a>
             <a class="btn btn-primary btn-sm" href="/login.html#register">Join the battle</a>`}
      </nav>
    </div>`;
  const menu = nav.querySelector('.menu-btn');
  const linksEl = nav.querySelector('.nav-links');
  menu.onclick = () => {
    const open = linksEl.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.querySelector('i').className = `ph ${open ? 'ph-x' : 'ph-list'}`;
  };
  const themeBtn = nav.querySelector('.theme-btn');
  const paintTheme = () => { themeBtn.querySelector('i').className = `ph ${effectiveTheme() === 'dark' ? 'ph-sun' : 'ph-moon'}`; };
  paintTheme();
  themeBtn.onclick = () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    paintTheme();
  };
  nav.querySelector('.logout-btn')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });
}

export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'toasts' });
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const el = Object.assign(document.createElement('div'), { className: `toast ${kind}`, textContent: message });
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

// Runs fn now and every ms while the tab is visible.
export function poll(fn, ms) {
  fn();
  setInterval(() => { if (!document.hidden) fn(); }, ms);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
}

export const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

export const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const statusBadge = (status) =>
  ({ live: '<span class="badge badge-live">Live</span>', ended: '<span class="badge">Ended</span>' })[status] || '<span class="badge">Upcoming</span>';

export const ordinal = (n) => (n == null ? '-' : `#${n}`);

// Escape first, then allow `inline code` and blank-line paragraphs.
export const richText = (s) =>
  esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>')}</p>`).join('');
