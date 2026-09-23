// Разметка карточки группы — строками, без DOM.
// Один и тот же модуль зовёт и живой поиск, и генератор статических страниц:
// так карточка в выдаче и карточка на SEO-странице не могут разойтись.

import { ageNote, GRID } from './model.js';
import { cardCover, cardTilt, dirIcon } from './visual.js';
import {
  DAY_SHORT, distance, groupsWord, intake, lessonsWord, plural, price, span, time, yearsWord
} from './format.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function groupUrl(group) {
  return `/g/${group.id}-${group.slug}/`;
}

/* ── полоса занятия ──────────────────────────────────────────────────────── */

// Одна графика в двух масштабах: та же полоса, что в недельной сетке наверху.
// Видно не «подходит / не подходит», а насколько занятие вылезает из окна.
const pos = (minutes) => ((minutes - GRID.dayStart) / (GRID.dayEnd - GRID.dayStart)) * 100;

function lessonRow(lesson, hasWindows, dayWindows) {
  const left = pos(lesson.start);
  const width = pos(lesson.end) - left;
  const state = !hasWindows ? 'plain' : lesson.fits ? 'fits' : 'misses';

  // Окно рисуется под занятием на той же шкале: видно не «да/нет», а на
  // сколько занятие вылезает. Ради этой картинки весь фильтр и сделан.
  const bands = dayWindows
    .map((w) => `<span class="lesson__win" style="left:${pos(w.from).toFixed(2)}%;width:${(pos(w.to) - pos(w.from)).toFixed(2)}%"></span>`)
    .join('');

  let note = '';
  if (hasWindows && !lesson.fits) {
    note =
      lesson.overhang === Infinity
        ? 'этот день не выбран'
        : `${lesson.overhang} мин за окном`;
  }
  return `<li class="lesson lesson--${state}">
    <span class="lesson__day">${DAY_SHORT[lesson.day]}</span>
    <span class="lesson__time">${span(lesson.start, lesson.end)}</span>
    <span class="lesson__track" aria-hidden="true">${bands}<span class="lesson__bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span></span>
    <span class="lesson__note">${note}</span>
  </li>`;
}

function lessonsBlock(match, group, windows = []) {
  const hasWindows = match ? match.lessons.some((l) => 'fits' in l) : false;
  const lessons = match ? match.lessons : group.lessons;
  const byDay = new Map();
  for (const w of windows) {
    if (!byDay.has(w.day)) byDay.set(w.day, []);
    byDay.get(w.day).push(w);
  }
  const rows = lessons.map((l) => lessonRow(l, hasWindows, byDay.get(l.day) || [])).join('');
  let summary = '';
  if (hasWindows) {
    const fit = match.fitCount;
    const total = lessons.length;
    summary =
      fit === total
        ? `<p class="fitline fitline--all">Все ${lessonsWord(total).replace(/^\d+\s/, total + ' ')} в вашем окне</p>`
        : `<p class="fitline">В окно попадает ${fit} ${plural(fit, 'занятие', 'занятия', 'занятий')} из ${total}</p>`;
  }
  return `<ul class="lessons">${rows}</ul>${summary}`;
}

/* ── возраст ─────────────────────────────────────────────────────────────── */

// Диапазон группы — в пилюле; здесь то, что обещано в шаге 1: сколько лет
// каждый ребёнок ещё проходит в этой группе.
function ageBlock(group, children, match) {
  const rows = children.map((child, i) => {
    const note = ageNote(group, child.age);
    const label = child.name ? `${esc(child.name)}, ${child.age}` : `${child.age} ${plural(child.age, 'год', 'года', 'лет')}`;
    if (!note) return '';
    const kind = match && match.matched.includes(i) ? 'yes' : 'near';
    return `<li class="age__row age__row--${kind}"><span class="age__who">${label}</span><span class="age__note">${note.text}</span></li>`;
  });
  return `<ul class="age">${rows.join('')}</ul>`;
}

/* ── карточка ────────────────────────────────────────────────────────────── */

// Сердце — из эталона.
const HEART =
  '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>';

const NBSP = ' ';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const thousands = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

// Расписание пилюлями, как в эталоне: «Вт, Чт · 17:30–19:00». Занятия с
// одинаковым временем сливаются в одну пилюлю, с разным — в соседние.
function scheduleSlots(lessons) {
  const slots = new Map();
  for (const l of [...lessons].sort((a, b) => a.day - b.day || a.start - b.start)) {
    const key = `${l.start}-${l.end}`;
    if (!slots.has(key)) slots.set(key, { start: l.start, end: l.end, days: [] });
    slots.get(key).days.push(l.day);
  }
  return [...slots.values()].map((s) => `${s.days.map((d) => cap(DAY_SHORT[d])).join(', ')} · ${time(s.start)}–${time(s.end)}`);
}

// Статус набора — из того же intake(), что и всё остальное про набор:
// второго источника правды о наборе в проекте нет. «Мало мест» не пишем —
// этого каталог не знает.
function intakePill(start) {
  if (start.days <= 0) return { text: 'Набор открыт', kind: 'open' };
  if (start.days === 1) return { text: 'Старт завтра', kind: 'soon' };
  if (start.days <= 30) return { text: `Старт через ${start.days} ${plural(start.days, 'день', 'дня', 'дней')}`, kind: start.urgent ? 'soon' : 'later' };
  return { text: cap(start.text), kind: 'later' };
}

export function groupCard(item, opts = {}) {
  const g = item.group || item;
  const match = item.match || null;
  const children = opts.children || [];
  const windows = opts.windows || [];
  const now = opts.now || new Date();
  const start = intake(g.intakeStart, now);
  const status = intakePill(start);
  const dist = match && match.distance != null ? distance(match.distance) : null;
  const tools = opts.compare !== false;

  const subtype = g.subtype ? ` <span class="card__subtype">${esc(g.subtype)}</span>` : '';
  const trial = g.trial.has
    ? g.trial.free
      ? 'пробное бесплатно'
      : `пробное ${price(g.priceSingle)}`
    : 'без пробного';

  // Когда окно задано, расписание показывает полоса занятия на шкале дня —
  // она говорит больше пилюли: не только когда, но и на сколько вылезает.
  // Пилюли с тем же временем рядом с ней были бы повтором.
  const withWindows = windows.length > 0 && match;
  const pills = [
    `<li class="pill pill--age">${g.ageFrom}–${g.ageTo}${NBSP}${plural(g.ageTo, 'год', 'года', 'лет')}</li>`,
    ...(withWindows ? [] : scheduleSlots(g.lessons).map((s) => `<li class="pill pill--when">${s}</li>`)),
    `<li class="pill pill--metro">м.${NBSP}${esc(g.branch.stationName)}</li>`,
    dist ? `<li class="pill pill--dist">${dist} по${NBSP}прямой</li>` : ''
  ].join('');

  return `<article class="card" data-dir="${esc(g.direction)}"${opts.id ? ` id="${esc(opts.id)}"` : ''}>
  <div class="card__cover">${cardCover(g)}
    <span class="card__badge" style="--tilt:${cardTilt(g)}deg">${dirIcon(g.direction, 36)}</span>
    <span class="card__status card__status--${status.kind}">${esc(status.text)}</span>
    ${tools ? `<button type="button" class="fav" data-follow="${g.id}" aria-pressed="false" aria-label="Отслеживать группу">${HEART}</button>
    <label class="cmp"><input type="checkbox" class="cmp__box" value="${g.id}"${opts.compared ? ' checked' : ''}> Сравнить</label>` : ''}
  </div>
  <div class="card__body">
    <div class="card__head">
      <h3 class="card__title"><a href="${groupUrl(g)}">${esc(g.dir.short)}: ${esc(g.title)}</a>${subtype}</h3>
      <p class="card__org">${esc(g.org.name)}</p>
    </div>

    <ul class="card__pills">${pills}</ul>
    <p class="card__addr">${esc(g.branch.address)} · ${distance(g.branch.metroDistance)} до метро</p>

    ${children.length ? ageBlock(g, children, match) : ''}
    ${withWindows ? lessonsBlock(match, g, windows) : ''}

    <p class="card__meta">${g.level === 'start' ? 'С нуля' : 'Для продолжающих'} · до ${g.groupSize} ${plural(g.groupSize, 'человека', 'человек', 'человек')} в группе · ${trial}</p>

    <div class="card__foot">
      <p class="card__price"><span class="card__sum">${thousands(g.priceMonth)}</span> ₽/мес<span class="card__single">разово ${price(g.priceSingle)}</span></p>
      ${tools ? `<a class="card__go" href="${groupUrl(g)}">Подробнее</a>` : ''}
    </div>
  </div>
</article>`;
}

/* ── компактная строка для статических страниц ───────────────────────────── */

export function groupRow(g, opts = {}) {
  const schedule = g.lessons.map((l) => `${DAY_SHORT[l.day]} ${time(l.start)}—${time(l.end)}`).join(', ');
  // Расстояние всегда подписано, ДО ЧЕГО оно: иначе «1,4 км» рядом с названием
  // чужой станции читается как расстояние до неё.
  const place = opts.distance == null
    ? esc(g.branch.stationName)
    : `${esc(g.branch.stationName)} — ${distance(opts.distance)} ${opts.distanceTo ? `до «${esc(opts.distanceTo)}»` : 'отсюда'} по прямой`;
  return `<li class="row" data-dir="${esc(g.direction)}">
  <h3 class="row__title">${opts.dot ? '<span class="dot"></span>' : ''}<a href="${groupUrl(g)}">${esc(g.dir.short)}: ${esc(g.title)}</a></h3>
  <p class="row__org">${esc(g.org.name)}, ${esc(g.branch.address)}</p>
  <p class="row__meta">
    <span>${g.ageFrom}—${g.ageTo} ${plural(g.ageTo, 'год', 'года', 'лет')}</span>
    <span>${schedule}</span>
    <span class="num">${price(g.priceMonth)} в месяц</span>
    <span>${place}</span>
  </p>
</li>`;
}

/* ── «обоих сразу» ───────────────────────────────────────────────────────── */

export function togetherCard(variant, children) {
  const who = (idx) =>
    idx.map((i) => esc(children[i].name || `${children[i].age} ${plural(children[i].age, 'год', 'года', 'лет')}`)).join(' и ');

  const lines = variant.entries
    .map((e) => {
      const g = e.item.group;
      const when = e.lessons.map((l) => `${DAY_SHORT[l.day]} ${span(l.start, l.end)}`).join(', ');
      return `<li data-dir="${esc(g.direction)}"><span class="tog__who">${who(e.children)}</span>
        <span class="dot"></span>
        <a href="${groupUrl(g)}">${esc(g.dir.short)}: ${esc(g.title)}</a>
        <span class="tog__when">${when}</span>
        <span class="num">${price(g.priceMonth)}</span></li>`;
    })
    .join('');

  const sum = variant.single
    ? `Одна группа на двоих — <span class="num">${price(variant.price)}</span> в месяц вместо двух платежей`
    : `Обоих привозите в ${DAY_SHORT[variant.trip.day]} к ${time(variant.trip.from)}, забираете в ${time(variant.trip.to)} — <span class="num">${price(variant.price)}</span> в месяц за двоих`;

  return `<article class="tog">
    <p class="tog__head">${variant.single ? 'Одна группа берёт обоих' : 'Две группы в одно время'}<span class="tog__where">${esc(variant.org.name)}, ${esc(variant.branch.address)}</span></p>
    <ul class="tog__list">${lines}</ul>
    <p class="tog__sum">${sum}</p>
  </article>`;
}

/* ── подсказки при пустом результате ─────────────────────────────────────── */

export function suggestionList(items) {
  if (!items.length) return '';
  return `<ul class="fix">${items
    .map(
      (s, i) => `<li><button type="button" class="fix__btn" data-fix="${i}">
        <span class="fix__text">${esc(s.text)}</span>
        <span class="fix__count num">${s.count} ${plural(s.count, 'группа', 'группы', 'групп')}</span>
      </button></li>`
    )
    .join('')}</ul>`;
}

export { groupsWord, yearsWord };
