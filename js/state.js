// Состояние поиска ↔ query string. Чистые функции без DOM: этим же модулем
// генератор статических страниц собирает ссылки «открыть в поиске».

import { emptyQuery, normalizeWindows } from './model.js';

const DAY_CHARS = '1234567';

/* окна: 12345:1080-1320|6:540-780 */

function encodeWindows(windows) {
  // Одинаковые отрезки в разных днях пишем одной группой, иначе ссылка
  // распухает до нечитаемого размера.
  const bySpan = new Map();
  for (const w of normalizeWindows(windows)) {
    const key = `${w.from}-${w.to}`;
    if (!bySpan.has(key)) bySpan.set(key, []);
    bySpan.get(key).push(w.day);
  }
  return [...bySpan.entries()]
    .map(([span, days]) => `${days.sort().join('')}:${span}`)
    .join('|');
}

function decodeWindows(text) {
  if (!text) return [];
  const out = [];
  for (const chunk of text.split('|')) {
    const [days, span] = chunk.split(':');
    if (!days || !span) continue;
    const [from, to] = span.split('-').map(Number);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    for (const ch of days) {
      if (DAY_CHARS.includes(ch)) out.push({ day: Number(ch), from, to });
    }
  }
  return normalizeWindows(out);
}

const list = (value) => (value ? value.split(',').filter(Boolean) : []);

export function parseQuery(search) {
  const p = new URLSearchParams(search);
  const q = emptyQuery();

  q.directions = list(p.get('dir'));

  const ages = list(p.get('kids'))
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 2 && n <= 18);
  const names = list(p.get('kn'));
  q.children = ages.map((age, i) => ({ age, name: names[i] || '' }));

  q.windows = decodeWindows(p.get('win'));
  q.strict = p.get('strict') === '1';

  const geo = p.get('geo');
  if (geo === 'metro' || geo === 'rayon' || geo === 'near') {
    q.geoMode = geo === 'rayon' ? 'district' : geo;
  }
  q.stations = list(p.get('m'));
  q.districts = list(p.get('r'));

  const at = p.get('at');
  if (at) {
    const [lat, lon] = at.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      q.point = { lat, lon, label: p.get('place') || '' };
    }
  }
  const rad = Number(p.get('rad'));
  if (Number.isFinite(rad) && rad > 0) q.radius = rad;

  const sort = p.get('sort');
  if (['match', 'distance', 'price', 'intake'].includes(sort)) q.sort = sort;

  return q;
}

export function queryToSearch(q) {
  const p = new URLSearchParams();
  if (q.directions.length) p.set('dir', q.directions.join(','));
  if (q.children.length) {
    p.set('kids', q.children.map((c) => c.age).join(','));
    if (q.children.some((c) => c.name)) p.set('kn', q.children.map((c) => c.name || '').join(','));
  }
  if (q.windows.length) p.set('win', encodeWindows(q.windows));
  if (q.strict) p.set('strict', '1');
  if (q.geoMode !== 'off') {
    p.set('geo', q.geoMode === 'district' ? 'rayon' : q.geoMode);
    if (q.geoMode === 'metro' && q.stations.length) p.set('m', q.stations.join(','));
    if (q.geoMode === 'district' && q.districts.length) p.set('r', q.districts.join(','));
    if (q.geoMode === 'near' && q.point) {
      p.set('at', `${q.point.lat.toFixed(5)},${q.point.lon.toFixed(5)}`);
      if (q.point.label) p.set('place', q.point.label);
      p.set('rad', String(q.radius));
    }
  }
  if (q.sort !== 'match') p.set('sort', q.sort);
  const text = p.toString();
  return text ? `?${text}` : '';
}

export const sameQuery = (a, b) => queryToSearch(a) === queryToSearch(b);

// Ссылка со статической страницы в живой поиск.
export function deepLink(base, patch) {
  const q = { ...emptyQuery(), ...patch };
  return `${base}${queryToSearch(q)}`;
}
