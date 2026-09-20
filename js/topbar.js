// Шапка: профиль, колокольчик и панель входа.
//
// Ничего не загораживает. Гость видит обычную ссылку «Войти» и кнопку
// демо-кабинета; панель входа раскрывается на месте и ничего не перекрывает,
// потому что поиск в этот момент продолжает работать.

import { isDemo, me } from './account.js';
import { emptyArt } from './visual.js';
import { plural } from './format.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BELL =
  '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 21h4"/></svg>';

function when(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 3600) {
    const m = Math.max(1, Math.round(diff / 60));
    return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  }
  if (diff < 86400) {
    const h = Math.round(diff / 3600);
    return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  }
  const d = Math.round(diff / 86400);
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
}

let botName = '';
export const setBot = (name) => { botName = name || ''; };

export function loginPanel(reason) {
  const bot = botName;
  const box = document.createElement('div');
  box.className = 'login';
  box.innerHTML = `
    <p class="login__why">${esc(reason)}</p>
    <ul class="login__list">
      <li>Сохранять поиски и получать письмо, когда появится подходящая группа</li>
      <li>Отслеживать цену и набор в выбранных группах</li>
      <li>Видеть свои заявки на пробное и что по ним ответили</li>
    </ul>
    <div class="login__widget" id="login-widget"></div>
    <p class="login__note">Вход через Telegram: ни паролей, ни почты. Поиском и карточками можно пользоваться и без входа.</p>
    <p class="login__demo"><a class="btn btn--quiet" href="/lk/?demo=1">Посмотреть кабинет с демо-данными</a>
      <button type="button" class="linkbtn login__hide">Скрыть</button></p>`;
  box.querySelector('.login__hide').addEventListener('click', () => box.remove());

  const slot = box.querySelector('#login-widget');
  if (bot) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', bot);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-userpic', 'false');
    // Без права писать бот не сможет прислать уведомление первым.
    s.setAttribute('data-request-access', 'write');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    slot.append(s);
  } else {
    slot.innerHTML =
      '<p class="login__off">Кнопка Telegram не настроена: не задано имя бота. Демо-кабинет работает и без неё.</p>';
  }
  return box;
}

window.onTelegramAuth = async (user) => {
  try {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Вход не прошёл');
    location.reload();
  } catch (err) {
    const slot = document.getElementById('login-widget');
    if (slot) slot.insertAdjacentHTML('afterend', `<p class="login__off">${esc(err.message)}</p>`);
  }
};

export async function mountTopbar(root, { onState } = {}) {
  if (!root) return null;
  let state = null;

  if (isDemo()) {
    // Колокольчик в демо показывает те же уведомления, что и кабинет:
    // иначе заказчик увидит пустую иконку и решит, что она не работает.
    const demo = await fetch('/data/demo-account.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    state = demo
      ? { user: demo.user, unread: demo.unread, notes: demo.notes, bot: '' }
      : { user: { first_name: 'Иван' }, unread: 0, notes: [] };
  } else {
    state = await me().catch(() => ({ user: null }));
  }
  setBot(state.bot);
  if (onState) onState(state);

  if (!state.user) {
    root.innerHTML =
      '<a class="top__link" href="/lk/">Кабинет</a><button type="button" class="top__link top__link--go" id="top-login">Войти</button>';
    root.querySelector('#top-login').addEventListener('click', () => {
      const existing = document.querySelector('.login--drop');
      if (existing) return existing.remove();
      const panel = loginPanel('Вход нужен только для трёх вещей.');
      panel.classList.add('login--drop');
      root.after(panel);
    });
    return state;
  }

  const unread = state.unread || 0;
  root.innerHTML = `
    <div class="bell">
      <button type="button" class="bell__btn" id="bell-btn" aria-expanded="false"
        aria-label="Уведомления${unread ? `, непрочитанных ${unread}` : ''}">
        ${BELL}<span class="bell__n num" id="bell-n" aria-live="polite">${unread || ''}</span>
      </button>
      <div class="bell__drop" id="bell-drop" hidden></div>
    </div>
    <a class="top__link" href="/lk/">${esc(state.user.first_name || 'Кабинет')}</a>`;

  const btn = root.querySelector('#bell-btn');
  const drop = root.querySelector('#bell-drop');

  const paint = () => {
    const notes = state.notes || [];
    drop.innerHTML = notes.length
      ? `<p class="bell__head">Уведомления<button type="button" class="bell__all" id="bell-all">Прочитать все</button></p>
         <ul class="bell__list">${notes
           .slice(0, 12)
           .map(
             (n) => `<li class="bell__item${n.read_at ? '' : ' bell__item--new'}" data-dir="${esc(n.dir || '')}">
               <a href="${esc(n.url || '/lk/')}" data-note="${esc(n.id)}">
                 <span class="bell__title">${esc(n.title)}</span>
                 <span class="bell__body">${esc(n.body)}</span>
                 <span class="bell__when">${when(n.created_at)}</span>
               </a></li>`
           )
           .join('')}</ul>`
      : `<div class="bell__empty nothing-here">${emptyArt('compare')}<p>Уведомлений пока нет. Они появятся, когда по сохранённому поиску найдётся новая группа или подойдёт пробное занятие.</p></div>`;
  };

  const close = () => {
    drop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', () => {
    const open = drop.hidden;
    drop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) paint();
  });

  drop.addEventListener('click', async (e) => {
    if (e.target.id === 'bell-all') {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
        credentials: 'same-origin'
      }).then((r) => r.json());
      state.notes = res.notes;
      state.unread = res.unread;
      root.querySelector('#bell-n').textContent = '';
      paint();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drop.hidden) {
      close();
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!drop.hidden && !root.contains(e.target)) close();
  });

  return state;
}
