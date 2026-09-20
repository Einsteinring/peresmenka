// Кабинет: заявки, сохранённые поиски, избранное, настройки уведомлений.
//
// Три раздела вкладками, выбранная вкладка живёт в адресе. Данные приходят
// одинаковой формы из живого API и из демо-заготовки — см. js/account.js.

import { createAccount, isDemo } from './account.js';
import { loginPanel, mountTopbar } from './topbar.js';
import { dirIcon, emptyArt } from './visual.js';
import { dateShort, groupsWord, intake, plural, price } from './format.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const account = createAccount();
const TABS = [
  { id: 'leads', name: 'Заявки' },
  { id: 'saves', name: 'Сохранённые поиски' },
  { id: 'favs', name: 'Избранное' }
];
const STAGES = [
  { id: 'sent', name: 'заявка отправлена' },
  { id: 'replied', name: 'центр ответил' },
  { id: 'visited', name: 'посещено' },
  { id: 'cancelled', name: 'отменена' }
];

let tab = new URLSearchParams(location.search).get('tab') || 'leads';

/* ── общие куски ─────────────────────────────────────────────────────────── */

const groupLine = (g) => `
  <p class="lkc__org">${esc(g.org)}</p>
  <p class="lkc__place">${esc(g.address)}<span>${esc(g.station)}</span></p>`;

function whenTrial(iso) {
  const at = new Date(iso);
  const days = Math.round((at - Date.now()) / 86400000);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const text = `${dateShort(iso.slice(0, 10))}, ${time}`;
  // Янтарным — только то, что поджимает по времени.
  return { text, urgent: days >= 0 && days <= 1, days };
}

/* ── заявки ──────────────────────────────────────────────────────────────── */

function leadsView(state) {
  if (!state.leads.length) {
    return empty('compare', 'Заявок пока нет', 'Нашли подходящую группу — отправьте заявку на пробное с её страницы. Она появится здесь вместе с ответом центра.');
  }

  return state.leads
    .map((l) => {
      const g = l.group;
      const trial = l.trialAt ? whenTrial(l.trialAt) : null;
      const done = STAGES.findIndex((s) => s.id === l.status);
      const steps = STAGES.filter((s) => s.id !== 'cancelled')
        .map((s, i) => {
          const state_ = l.status === 'cancelled' ? 'off' : i < done ? 'done' : i === done ? 'now' : 'off';
          return `<li class="step step--${state_}">${esc(s.name)}</li>`;
        })
        .join('');

      return `<article class="lkc" data-dir="${esc(g.direction)}">
        <div class="lkc__mark">${dirIcon(g.direction, 20)}</div>
        <div class="lkc__body">
          <h3 class="lkc__title"><a href="${esc(g.url)}">${esc(g.dirShort)}: ${esc(g.title)}</a></h3>
          ${groupLine(g)}
          <p class="lkc__trial${trial && trial.urgent ? ' lkc__trial--soon' : ''}">
            ${trial ? `Пробное ${esc(trial.text)}` : 'Время пробного уточняется'}
            ${trial && trial.days === 1 ? ' — завтра' : ''}
          </p>
          <p class="lkc__meta">${esc(l.child)}, ${l.childAge} ${plural(l.childAge, 'год', 'года', 'лет')} · звонить ${esc(l.callTime)}</p>
          <p class="lkc__meta">Взять: ${esc(g.brings)}</p>
          <ol class="steps">${steps}</ol>
          <div class="lkc__stage">
            <label>Стадия
              <select data-lead="${esc(l.id)}">
                ${STAGES.map((s) => `<option value="${s.id}"${s.id === l.status ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
              </select>
            </label>
            <span class="lkc__stagenote">Демо-режим: настоящие центры к каталогу не подключены, первая стадия приходит через минуту после заявки, дальше стадии переключаются вручную.</span>
          </div>
        </div>
      </article>`;
    })
    .join('');
}

/* ── сохранённые поиски ──────────────────────────────────────────────────── */

function savesView(state) {
  if (!state.saves.length) {
    return empty('nothing', 'Сохранённых поисков нет', 'Задайте фильтры на главной и нажмите «Сохранить поиск». Мы будем присылать уведомление, когда появится новая подходящая группа.');
  }

  return state.saves
    .map(
      (s) => `<article class="lks">
        <h3 class="lks__name">${esc(s.name)}</h3>
        <p class="lks__count"><span class="num">${s.count}</span> ${plural(s.count, 'группа подходит', 'группы подходят', 'групп подходят')} сейчас</p>
        ${s.sample && s.sample.length ? `<p class="lks__sample">${s.sample.map((g) => `<span data-dir="${esc(g.direction)}"><span class="dot"></span>${esc(g.dirShort)}: ${esc(g.title)}</span>`).join('')}</p>` : ''}
        <div class="lks__acts">
          <a class="btn btn--quiet" href="/${esc(s.search)}">Открыть поиск</a>
          <label class="switch"><input type="checkbox" data-notify="${esc(s.id)}"${s.notify ? ' checked' : ''}> уведомлять о новых</label>
          <button type="button" class="linkbtn" data-drop-save="${esc(s.id)}">Удалить</button>
        </div>
      </article>`
    )
    .join('');
}

/* ── избранное ───────────────────────────────────────────────────────────── */

function favsView(state) {
  if (!state.favs.length) {
    return empty('age', 'Ничего не отслеживаете', 'Нажмите «Отслеживать» в карточке группы — будем присылать уведомление, если изменится цена или начнёт закрываться набор.');
  }

  const now = new Date();
  return state.favs
    .map((g) => {
      const start = intake(g.intakeStart, now);
      return `<article class="lkc" data-dir="${esc(g.direction)}">
        <div class="lkc__mark">${dirIcon(g.direction, 20)}</div>
        <div class="lkc__body">
          <h3 class="lkc__title"><a href="${esc(g.url)}">${esc(g.dirShort)}: ${esc(g.title)}</a></h3>
          ${groupLine(g)}
          <p class="lkc__meta">${esc(g.ages)} лет · ${esc(g.schedule)}</p>
          <p class="lkc__price">
            <span class="num">${price(g.priceMonth)}</span> в месяц
            ${g.priceWas ? `<span class="lkc__was">было ${price(g.priceWas)}${g.priceDown ? ', стало дешевле' : ', подорожало'}</span>` : ''}
          </p>
          <p class="lkc__meta${start.urgent ? ' lkc__urgent' : ''}">${esc(start.text)}${start.days > 0 && start.days <= 14 ? ` — через ${start.days} ${plural(start.days, 'день', 'дня', 'дней')}` : ''}</p>
          <div class="lkc__acts">
            <button type="button" class="linkbtn" data-drop-fav="${esc(g.id)}">Не отслеживать</button>
          </div>
        </div>
      </article>`;
    })
    .join('');
}

/* ── настройки ───────────────────────────────────────────────────────────── */

function prefsView(state) {
  const p = state.prefs || { channels: {}, quiet: {} };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `<section class="lkp">
    <h2>Как присылать</h2>
    <label class="switch"><input type="checkbox" id="ch-web"${p.channels.web !== false ? ' checked' : ''}> показывать в колокольчике</label>
    <label class="switch"><input type="checkbox" id="ch-tg"${p.channels.telegram !== false ? ' checked' : ''}> присылать в Telegram</label>
    ${p.tg_ok === false ? '<p class="lkp__warn">Бот не может вам написать. Откройте бота и нажмите «Запустить», чтобы включить канал.</p>' : ''}
    <p class="lkp__quiet">Тихие часы: с <input type="time" id="q-from" value="${hhmm(p.quiet.from ?? 1320)}" step="1800"> до <input type="time" id="q-to" value="${hhmm(p.quiet.to ?? 480)}" step="1800">.
      В это время в Telegram не пишем, в колокольчике уведомление появляется сразу.</p>
  </section>`;
}

/* ── пустые состояния ────────────────────────────────────────────────────── */

const empty = (art, title, text) =>
  `<div class="nothing-here lk__empty">${emptyArt(art)}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

/* ── сборка ──────────────────────────────────────────────────────────────── */

function render(state) {
  const root = $('lk');

  if (!state.user) {
    root.innerHTML = '<div class="lk__guest" id="guest"></div>';
    $('guest').append(loginPanel('Кабинет хранит три вещи, и для них нужен вход.'));
    return;
  }

  const counts = { leads: state.leads.length, saves: state.saves.length, favs: state.favs.length };
  const body = tab === 'saves' ? savesView(state) : tab === 'favs' ? favsView(state) : leadsView(state);

  root.innerHTML = `
    <div class="lk__tabs" role="tablist">
      ${TABS.map(
        (t) => `<button type="button" role="tab" class="lk__tab" data-tab="${t.id}"
          aria-selected="${t.id === tab}">${esc(t.name)}<span class="num">${counts[t.id]}</span></button>`
      ).join('')}
    </div>
    <div class="lk__body" role="tabpanel">${body}</div>
    ${prefsView(state)}`;
}

async function guard(fn) {
  try {
    render(await fn());
  } catch (err) {
    const note = document.createElement('p');
    note.className = 'lk__err';
    note.textContent = err.message;
    $('lk').prepend(note);
  }
}

function wire() {
  $('lk').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      const url = new URL(location.href);
      url.searchParams.set('tab', tab);
      history.replaceState(null, '', url);
      render(account.state);
      return;
    }
    const dropSave = e.target.closest('[data-drop-save]');
    if (dropSave) return guard(() => account.removeSave(dropSave.dataset.dropSave));
    const dropFav = e.target.closest('[data-drop-fav]');
    if (dropFav) return guard(() => account.removeFav(dropFav.dataset.dropFav));
  });

  $('lk').addEventListener('change', (e) => {
    const notify = e.target.closest('[data-notify]');
    if (notify) return guard(() => account.updateSave(notify.dataset.notify, { notify: notify.checked }));

    const lead = e.target.closest('[data-lead]');
    if (lead) return guard(() => account.setLeadStatus(lead.dataset.lead, lead.value));

    if (['ch-web', 'ch-tg'].includes(e.target.id)) {
      return guard(() =>
        account.setPrefs({ channels: { web: $('ch-web').checked, telegram: $('ch-tg').checked } })
      );
    }
    if (['q-from', 'q-to'].includes(e.target.id)) {
      const toMin = (v) => {
        const [h, m] = v.split(':').map(Number);
        return h * 60 + Math.round(m / 30) * 30;
      };
      return guard(() => account.setPrefs({ quiet: { from: toMin($('q-from').value), to: toMin($('q-to').value) } }));
    }
  });
}

(async function boot() {
  if (isDemo()) $('demobar').hidden = false;
  await mountTopbar($('topme'));
  try {
    render(await account.load());
  } catch {
    $('lk').innerHTML = '<p class="lk__err">Кабинет не загрузился. Обновите страницу.</p>';
  }
  wire();
})();
