import { api, me, renderNav } from './app.js';

const next = new URLSearchParams(location.search).get('next');
const destination = (user) => (next?.startsWith('/') && !next.startsWith('//') ? next : user.role === 'admin' ? '/admin.html' : '/dashboard.html');

const existing = await me();
if (existing) location.replace(destination(existing));
renderNav(null);

const forms = { login: document.getElementById('login-form'), register: document.getElementById('register-form') };

function show(which) {
  for (const [name, form] of Object.entries(forms)) {
    form.hidden = name !== which;
    document.getElementById(`tab-${name}`).setAttribute('aria-selected', String(name === which));
  }
  forms[which].querySelector('input').focus({ preventScroll: true });
}

document.getElementById('tab-login').onclick = () => { history.replaceState(null, '', location.pathname + location.search); show('login'); };
document.getElementById('tab-register').onclick = () => { history.replaceState(null, '', '#register'); show('register'); };
if (location.hash === '#register') show('register');

for (const [name, form] of Object.entries(forms)) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = form.querySelector('.form-error');
    const button = form.querySelector('button[type="submit"]');
    const invalid = [...form.elements].find((el) => el.willValidate && !el.checkValidity());
    form.querySelectorAll('input').forEach((el) => el.removeAttribute('aria-invalid'));
    if (invalid) {
      invalid.setAttribute('aria-invalid', 'true');
      errorBox.textContent = invalid.type === 'password' && name === 'register'
        ? 'Password must be at least 8 characters.'
        : `Check the ${form.querySelector(`label[for="${invalid.id}"]`).childNodes[0].textContent.trim().toLowerCase()} field.`;
      errorBox.hidden = false;
      invalid.focus();
      return;
    }
    button.disabled = true;
    errorBox.hidden = true;
    try {
      const user = await api(`/api/${name}`, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      location.href = destination(user);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      button.disabled = false;
    }
  });
}
