// Каталог и индекс для серверных функций.
//
// Ровно тот же js/model.js, что и в браузере: подбор по сохранённому поиску
// и живой поиск не могут разойтись, потому что это один алгоритм, а не два
// похожих. Ради этого весь бэкенд и сделан на Node.

import { readFileSync } from 'node:fs';
import { buildIndex } from '../../js/model.js';

let cached = null;

export function getIndex() {
  if (cached) return cached;
  const read = (name) =>
    JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
  cached = buildIndex(read('catalog.json'), read('geo.json'));
  return cached;
}
