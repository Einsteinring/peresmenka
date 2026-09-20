// Страница группы: заявка на пробное и кнопка «Отслеживать».
//
// Заявку отправляет кто угодно — вход для этого не нужен. Если человек вошёл,
// заявка попадает к нему в кабинет, и он видит, что по ней ответили.

import { favIds, toggleFav } from './account.js';
import { loginPanel } from './topbar.js';

const form = document.getElementById('lead');
const msg = document.getElementById('lead-msg');

/* ── отправка заявки ─────────────────────────────────────────────────────── */

// Одна точка отправки: здесь меняется адрес, а не половина файла.
export async function sendLead(data) {
  const res = await fetch('/api/leads/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'same-origin'
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Не отправилось');
  return body;
}

if (form) {
  const digits = (s) => String(s || '').replace(/\D/g, '');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'lead__msg';

    const data = Object.fromEntries(new FormData(form).entries());
    const problems = [];
    if (!data.parent || data.parent.trim().length < 2) problems.push(['parent', 'Как к вам обращаться?']);
    if (digits(data.phone).length < 10) problems.push(['phone', 'Нужен телефон из 10 цифр — по нему перезвонят']);
    if (!data.child || data.child.trim().length < 2) problems.push(['child', 'Имя ребёнка']);
    const age = Number(data.childAge);
    if (!Number.isInteger(age) || age < 2 || age > 18) problems.push(['childAge', 'Возраст ребёнка от 2 до 18']);

    for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');

    if (problems.length) {
      const [name, text] = problems[0];
      const field = form.elements[name];
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      msg.className = 'lead__msg lead__msg--bad';
      msg.textContent = text;
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    msg.textContent = 'Отправляем…';

    try {
      const res = await sendLead({
        groupId: data.groupId,
        parent: data.parent.trim(),
        phone: data.phone.trim(),
        child: data.child.trim(),
        childAge: age,
        callTime: data.callTime
      });
      form.hidden = true;
      msg.className = 'lead__msg lead__msg--good';
      msg.innerHTML = res.saved
        ? 'Заявка принята. Она появилась в вашем кабинете — там будет видно, что ответил центр. <a href="/lk/?tab=leads">Открыть кабинет</a>'
        : 'Заявка принята. Это демонстрационный сайт: в настоящий центр она не уходит. Войдите, чтобы заявки сохранялись и было видно ответ.';
      msg.hidden = false;
      form.after(msg);
    } catch (err) {
      button.disabled = false;
      msg.className = 'lead__msg lead__msg--bad';
      msg.textContent = err.message;
    }
  });
}

/* ── отслеживание группы ─────────────────────────────────────────────────── */

const follow = document.querySelector('[data-follow]');

if (follow) {
  let ids = null;

  const paint = () => {
    const on = Boolean(ids && ids.has(follow.dataset.follow));
    follow.setAttribute('aria-pressed', String(on));
    follow.textContent = on ? 'Отслеживается' : 'Отслеживать';
  };

  favIds()
    .then((set) => {
      ids = set;
      paint();
    })
    .catch(() => {});

  follow.addEventListener('click', async () => {
    const id = follow.dataset.follow;
    if (!ids) {
      // Гостю ничего не запрещаем: объясняем, что даст вход, прямо здесь.
      const shown = document.querySelector('.login--here');
      if (shown) return shown.remove();
      const panel = loginPanel('Чтобы следить за ценой и набором в этой группе, нужен вход.');
      panel.classList.add('login--here');
      follow.closest('.facts__follow').after(panel);
      return;
    }
    const on = !ids.has(id);
    if (on) ids.add(id);
    else ids.delete(id);
    paint();
    try {
      await toggleFav(id, on);
    } catch {
      if (on) ids.delete(id);
      else ids.add(id);
      paint();
    }
  });
}
