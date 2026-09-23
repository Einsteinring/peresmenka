// Шапка: профиль, колокольчик и панель входа.
//
// Ничего не загораживает. Гость видит обычную ссылку «Войти» и кнопку
// демо-кабинета; панель входа раскрывается на месте и ничего не перекрывает,
// потому что поиск в этот момент продолжает работать.
//
// Способов входа два. Основной — открыть бота в приложении: браузер в
// опознании не участвует, и ничего ждать по сети не надо. Запасной — виджет
// Telegram с номером телефона; он спрятан под «другой способ», потому что
// его подтверждения доходят не везде.

import { isDemo, me } from './account.js';
import { emptyArt } from './visual.js';
import { plural } from './format.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BELL =
  '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

const USER =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';

const TG =
  '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 11.5 21 4l-3 16-5.5-4.5L9 19l-.5-4.5z"/><path d="m8.5 14.5 9-8"/></svg>';

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

/* ── вход по ссылке на бота ──────────────────────────────────────────────── */

const LIMIT = 5 * 60 * 1000; // дольше ждать бессмысленно: заявка живёт 10 минут

// Опрос, а не ожидание ответа: пока человек в Telegram, вкладка обычно
// скрыта, а таймеры в фоне браузер придерживает. Поэтому на возвращение
// к вкладке спрашиваем сразу, не дожидаясь следующего тика.
function pollLink(nonce, view) {
  const started = Date.now();
  let timer = 0;
  let seen = '';

  const stop = () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', wake);
  };

  async function tick() {
    clearTimeout(timer);
    if (!document.body.contains(view.root)) return stop();
    if (Date.now() - started > LIMIT) {
      stop();
      return view.expired();
    }

    let data = null;
    try {
      const res = await fetch(`/api/auth/link/?nonce=${encodeURIComponent(nonce)}`, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      data = await res.json();
    } catch {
      // Сеть моргнула — это не повод бросать вход, просто следующий заход.
    }

    if (data && data.status === 'ok') {
      stop();
      view.done();
      return;
    }
    if (data && data.status === 'expired') {
      stop();
      return view.expired();
    }
    if (data && data.status !== seen) {
      seen = data.status;
      if (seen === 'asked') view.asked();
    }

    timer = setTimeout(tick, Date.now() - started < 30000 ? 2000 : 5000);
  }

  function wake() {
    if (document.visibilityState === 'visible') tick();
  }

  document.addEventListener('visibilitychange', wake);
  timer = setTimeout(tick, 2000);
  return stop;
}

function appLogin(panel) {
  const btn = panel.querySelector('#login-app');
  const stepBox = panel.querySelector('#login-step');
  if (!btn || !stepBox) return;

  const show = (html) => {
    stepBox.hidden = false;
    stepBox.innerHTML = html;
  };

  let stopPoll = null;

  const restart = () => {
    if (stopPoll) stopPoll();
    stopPoll = null;
    stepBox.hidden = true;
    stepBox.innerHTML = '';
    btn.hidden = false;
    btn.disabled = false;
    btn.focus();
  };

  // Кнопка «начать заново» появляется в двух разных состояниях, поэтому
  // вешаем обработчик на контейнер, а не на каждую кнопку по отдельности.
  stepBox.addEventListener('click', (e) => {
    if (e.target.id === 'login-restart') restart();
  });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const was = btn.innerHTML;
    btn.innerHTML = 'Готовим ссылку…';

    let data;
    try {
      const res = await fetch('/api/auth/link/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'same-origin'
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось начать вход');
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = was;
      show(`<p class="login__off">${esc(err.message)}</p>`);
      return;
    }

    btn.hidden = true;
    show(`
      <p class="login__code-cap">Код этой попытки</p>
      <p class="login__code">${esc(data.code)}</p>
      <p class="login__go"><a class="btn btn--go" href="${esc(data.url)}" target="_blank" rel="noopener">${TG}Открыть Telegram</a></p>
      <p class="login__wait" id="login-wait">В боте нажмите «Запустить», а потом кнопку с кодом <b>${esc(data.code)}</b>.
        Код на кнопке и здесь должны совпадать — так вы видите, что бот спрашивает про эту вкладку, а не про чужую.</p>
      <p class="login__again"><button type="button" class="linkbtn" id="login-restart">Начать заново</button></p>`);

    stopPoll = pollLink(data.nonce, {
      root: panel,
      asked: () => {
        const wait = stepBox.querySelector('#login-wait');
        if (wait) wait.innerHTML = `Бот спросил подтверждение. Нажмите в нём кнопку с кодом <b>${esc(data.code)}</b>.`;
      },
      done: () => {
        show('<p class="login__wait">Вход подтверждён, открываем кабинет…</p>');
        location.reload();
      },
      expired: () =>
        show(`<p class="login__off">Ссылка устарела — заявка живёт десять минут.</p>
          <p class="login__again"><button type="button" class="linkbtn" id="login-restart">Начать заново</button></p>`)
    });
  });
}

/* ── виджет с номером ────────────────────────────────────────────────────── */

// Скрипт Telegram грузится только если человек раскрыл «другой способ»:
// это чужой домен, и большинству он не понадобится.
function lazyWidget(panel) {
  const alt = panel.querySelector('#login-alt');
  const slot = panel.querySelector('#login-widget');
  if (!alt || !slot) return;

  alt.addEventListener('toggle', () => {
    if (!alt.open || slot.dataset.loaded) return;
    slot.dataset.loaded = '1';
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', botName);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-userpic', 'false');
    // Без права писать бот не сможет прислать уведомление первым.
    s.setAttribute('data-request-access', 'write');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    slot.append(s);
  });
}

window.onTelegramAuth = async (user) => {
  try {
    const res = await fetch('/api/auth/telegram/', {
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

/* ── панель ──────────────────────────────────────────────────────────────── */

export function loginPanel(reason) {
  const box = document.createElement('div');
  box.className = 'login';
  box.innerHTML = `
    <p class="login__why">${esc(reason)}</p>
    <ul class="login__list">
      <li>Сохранять поиски и получать письмо, когда появится подходящая группа</li>
      <li>Отслеживать цену и набор в выбранных группах</li>
      <li>Видеть свои заявки на пробное и что по ним ответили</li>
    </ul>
    ${
      botName
        ? `<div class="login__ways">
             <button type="button" class="btn btn--go login__app" id="login-app">${TG}Войти через приложение Telegram</button>
             <div class="login__step" id="login-step" aria-live="polite" hidden></div>
             <details class="login__alt" id="login-alt">
               <summary>Другой способ — по номеру телефона</summary>
               <div class="login__widget" id="login-widget"></div>
               <p class="login__hint">Виджет попросит номер и пришлёт подтверждение служебным сообщением в Telegram.
                 Если оно не доходит, пользуйтесь входом через приложение — он этого пути не требует.</p>
             </details>
           </div>`
        : '<p class="login__off">Кнопка Telegram не настроена: не задано имя бота. Демо-кабинет работает и без неё.</p>'
    }
    <p class="login__note">Вход через Telegram: ни паролей, ни почты. Поиском и карточками можно пользоваться и без входа.</p>
    <p class="login__demo"><a class="btn btn--quiet" href="/lk/?demo=1">Посмотреть кабинет с демо-данными</a>
      <button type="button" class="linkbtn login__hide">Скрыть</button></p>`;

  box.querySelector('.login__hide').addEventListener('click', () => box.remove());
  if (botName) {
    appLogin(box);
    lazyWidget(box);
  }
  return box;
}

/* ── шапка ───────────────────────────────────────────────────────────────── */

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
      '<a class="top__link" href="/lk/">Кабинет</a>' +
      `<button type="button" class="top__link top__link--go profile profile--guest" id="top-login"><span class="profile__av">${USER}</span>Войти</button>`;
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
      <button type="button" class="bell__btn roundbtn" id="bell-btn" aria-expanded="false"
        aria-label="Уведомления${unread ? `, непрочитанных ${unread}` : ''}">
        ${BELL}<span class="bell__n num" id="bell-n" aria-live="polite">${unread || ''}</span>
      </button>
      <div class="bell__drop" id="bell-drop" hidden></div>
    </div>
    <a class="top__link profile" href="/lk/"><span class="profile__av" aria-hidden="true">${esc((state.user.first_name || 'К').slice(0, 1))}</span>${esc(state.user.first_name || 'Кабинет')}</a>`;

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
      const res = await fetch('/api/notes/', {
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
