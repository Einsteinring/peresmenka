// Человеческое имя сохранённого поиска, собранное из самих фильтров.
// Чистая функция без DOM: одинаково работает в браузере и в функции кабинета.
//
// «8 лет, будни после 18:00, Петроградская» полезнее, чем «Поиск №3», и не
// требует от человека ничего придумывать. Своё имя, если он его задал,
// всегда побеждает.

import { GRID } from './model.js';
import { DAY_SHORT, plural, time } from './format.js';

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function spanWords(from, to) {
  if (from <= GRID.dayStart && to >= GRID.dayEnd) return 'в любое время';
  if (to >= GRID.dayEnd) return `после ${time(from)}`;
  if (from <= GRID.dayStart) return `до ${time(to)}`;
  return `${time(from)}—${time(to)}`;
}

function windowWords(windows) {
  if (!windows.length) return null;

  // Окна с одинаковым отрезком времени объединяем по дням: «будни после 18:00»
  // читается, а «пн после 18:00, вт после 18:00, …» нет.
  const bySpan = new Map();
  for (const w of windows) {
    const key = `${w.from}-${w.to}`;
    if (!bySpan.has(key)) bySpan.set(key, { from: w.from, to: w.to, days: [] });
    bySpan.get(key).days.push(w.day);
  }

  const parts = [...bySpan.values()].map(({ from, to, days }) => {
    const sorted = [...days].sort((a, b) => a - b);
    let when;
    if (same(sorted, WEEKDAYS)) when = 'будни';
    else if (same(sorted, WEEKEND)) when = 'выходные';
    else if (sorted.length === 1) when = DAY_SHORT[sorted[0]];
    else when = sorted.map((d) => DAY_SHORT[d]).join(', ');
    return `${when} ${spanWords(from, to)}`;
  });

  return parts.length <= 2 ? parts.join(' и ') : `${parts[0]} и ещё ${parts.length - 1}`;
}

function childrenWords(children) {
  if (!children.length) return null;
  if (children.length === 1) {
    const a = children[0].age;
    return `${a} ${plural(a, 'год', 'года', 'лет')}`;
  }
  if (children.length === 2) return `дети ${children[0].age} и ${children[1].age}`;
  return `${children.length} ${plural(children.length, 'ребёнок', 'ребёнка', 'детей')}`;
}

function placeWords(q, index) {
  if (q.geoMode === 'metro' && q.stations.length) {
    const names = q.stations.map((id) => index.stationById.get(id)?.name).filter(Boolean);
    if (!names.length) return null;
    return names.length <= 2 ? names.join(' и ') : `${names[0]} и ещё ${names.length - 1}`;
  }
  if (q.geoMode === 'district' && q.districts.length) {
    const names = q.districts.map((id) => index.districtById.get(id)?.name).filter(Boolean);
    if (!names.length) return null;
    return names.length <= 2 ? names.join(' и ') : `${names[0]} и ещё ${names.length - 1}`;
  }
  if (q.geoMode === 'near' && q.point) {
    const km = (q.radius / 1000).toString().replace('.', ',');
    return `${q.point.label ? `рядом с «${q.point.label}»` : 'рядом со мной'}, ${km} км`;
  }
  return null;
}

function directionWords(q, index) {
  if (!q.directions.length) return null;
  const names = q.directions.map((id) => index.directionById.get(id)?.short).filter(Boolean);
  if (!names.length) return null;
  if (names.length <= 2) return names.join(' и ');
  return `${names.length} ${plural(names.length, 'направление', 'направления', 'направлений')}`;
}

export function describeQuery(q, index) {
  const parts = [
    directionWords(q, index),
    childrenWords(q.children),
    windowWords(q.windows),
    placeWords(q, index)
  ].filter(Boolean);

  if (!parts.length) return 'Весь каталог';
  if (q.strict && q.windows.length) parts.push('все занятия в окне');

  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
