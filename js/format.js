// Форматирование. Один модуль на браузер и на генератор страниц: числа
// в карточке поиска и в статическом HTML обязаны совпадать до знака.

const NBSP = ' ';

export const DAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const DAY_FULL = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const DAY_ACC = ['', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'];

export function time(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function span(from, to) {
  return `${time(from)} — ${time(to)}`;
}

export function price(value) {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₽`;
}

export function distance(meters) {
  if (meters == null) return '';
  if (meters < 950) return `${Math.round(meters / 10) * 10}${NBSP}м`;
  const km = meters / 1000;
  const text = km < 10 ? km.toFixed(1).replace('.', ',') : String(Math.round(km));
  return `${text}${NBSP}км`;
}

// Склонение: 1 группа, 2 группы, 5 групп
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const groupsWord = (n) => `${n} ${plural(n, 'группа', 'группы', 'групп')}`;
export const yearsWord = (n) => `${n} ${plural(n, 'год', 'года', 'лет')}`;
export const lessonsWord = (n) => `${n} ${plural(n, 'занятие', 'занятия', 'занятий')}`;

export function ageRange(from, to) {
  return `${from}—${to}${NBSP}${plural(to, 'год', 'года', 'лет')}`;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function dateShort(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

// Дата набора глазами родителя: «набор идёт» полезнее, чем «6 сентября».
export function intake(isoDate, now = new Date()) {
  const start = new Date(`${isoDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((start - today) / 86400000);
  if (days <= 0) return { text: 'набор идёт', soon: true, days };
  if (days === 1) return { text: 'старт завтра', soon: true, days };
  if (days <= 30) return { text: `старт ${dateShort(isoDate)}`, soon: true, days };
  return { text: `старт ${dateShort(isoDate)}`, soon: false, days };
}

// «пн, чт» или «пн, ср, пт»
export function daysList(lessons) {
  const uniq = [...new Set(lessons.map((l) => l.day))].sort((a, b) => a - b);
  return uniq.map((d) => DAY_SHORT[d]).join(', ');
}
