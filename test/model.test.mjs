import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildIndex, countOnly, emptyQuery, facetCount, haversine, lessonFit, maskToWindows,
  windowsToMask, normalizeWindows, shiftWindows, search, suggestions, togetherVariants,
  ageNote, usableLessons, GRID, PRESETS
} from '../js/model.js';
import { parseQuery, queryToSearch } from '../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const geo = JSON.parse(readFileSync(join(ROOT, 'data', 'geo.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'catalog.json'), 'utf8'));
const index = buildIndex(catalog, geo);

const byDay = (windows) => {
  const map = new Map();
  for (const w of windows) {
    if (!map.has(w.day)) map.set(w.day, []);
    map.get(w.day).push(w);
  }
  return map;
};

/* ── главное правило проекта ─────────────────────────────────────────────── */

test('занятие подходит, только если целиком внутри окна', () => {
  const after18 = byDay([{ day: 2, from: 1080, to: 1320 }]);

  // 17:45—19:15 при окне «после 18:00» не подходит: родитель не заберёт
  // ребёнка из школы раньше. Пересечение есть, а попадания нет.
  assert.equal(lessonFit({ day: 2, start: 1065, end: 1155 }, after18).fits, false);
  assert.equal(lessonFit({ day: 2, start: 1080, end: 1170 }, after18).fits, true);
  assert.equal(lessonFit({ day: 2, start: 1230, end: 1320 }, after18).fits, true);
  // конец ровно по краю окна — подходит
  assert.equal(lessonFit({ day: 2, start: 1260, end: 1320 }, after18).fits, true);
  // вылезает на минуту — уже нет
  assert.equal(lessonFit({ day: 2, start: 1260, end: 1321 }, after18).fits, false);
  // другой день
  assert.equal(lessonFit({ day: 3, start: 1080, end: 1140 }, after18).fits, false);
});

test('перелёт считается до ближайшего окна того же дня', () => {
  const win = byDay([{ day: 1, from: 1080, to: 1200 }]);
  assert.equal(lessonFit({ day: 1, start: 1065, end: 1155 }, win).overhang, 15);
  assert.equal(lessonFit({ day: 1, start: 1170, end: 1260 }, win).overhang, 60);
  assert.equal(lessonFit({ day: 4, start: 1080, end: 1140 }, win).overhang, Infinity);
});

test('два окна в одном дне не склеиваются в одно', () => {
  const win = byDay([
    { day: 6, from: 540, to: 660 },
    { day: 6, from: 780, to: 900 }
  ]);
  // занятие в «дырке» между окнами не подходит, хотя лежит между ними
  assert.equal(lessonFit({ day: 6, start: 690, end: 750 }, win).fits, false);
  assert.equal(lessonFit({ day: 6, start: 600, end: 660 }, win).fits, true);
});

/* ── маска и окна ────────────────────────────────────────────────────────── */

test('маска и окна переводятся друг в друга без потерь', () => {
  const windows = [
    { day: 1, from: 960, to: 1170 },
    { day: 1, from: 1200, to: 1260 },
    { day: 6, from: 540, to: 720 }
  ];
  assert.deepEqual(maskToWindows(windowsToMask(windows)), normalizeWindows(windows));
});

test('соседние окна одного дня сливаются', () => {
  const merged = normalizeWindows([
    { day: 3, from: 960, to: 1080 },
    { day: 3, from: 1080, to: 1200 }
  ]);
  assert.deepEqual(merged, [{ day: 3, from: 960, to: 1200 }]);
});

test('сдвиг окна не выходит за границы суток', () => {
  const shifted = shiftWindows([{ day: 1, from: GRID.dayStart, to: GRID.dayStart + 60 }], -120);
  assert.equal(shifted[0].from, GRID.dayStart);
});

/* ── расстояние ──────────────────────────────────────────────────────────── */

test('гаверсинус: Спортивная — Чкаловская около 830 метров', () => {
  const a = index.stationById.get('sportivnaya');
  const b = index.stationById.get('chkalovskaya');
  const d = haversine(a.lat, a.lon, b.lat, b.lon);
  assert.ok(d > 780 && d < 880, `получилось ${Math.round(d)} м`);
});

test('гаверсинус: расстояние до самой себя — ноль', () => {
  const a = index.stationById.get('parnas');
  assert.equal(Math.round(haversine(a.lat, a.lon, a.lat, a.lon)), 0);
});

/* ── возраст ─────────────────────────────────────────────────────────────── */

test('подпись возраста говорит про запас лет, а не про диапазон', () => {
  const g = { ageFrom: 6, ageTo: 11 };
  assert.equal(ageNote(g, 8).kind, 'middle');
  assert.match(ageNote(g, 8).text, /ещё 3 года/);
  assert.equal(ageNote(g, 10).kind, 'short');
  assert.equal(ageNote(g, 11).kind, 'last');
  assert.equal(ageNote(g, 6).kind, 'youngest');
  assert.equal(ageNote(g, 5).kind, 'younger');
  assert.equal(ageNote(g, 12).kind, 'older');
  assert.equal(ageNote(g, 4), null);
  assert.equal(ageNote(g, 14), null);
});

/* ── URL ─────────────────────────────────────────────────────────────────── */

test('состояние переживает дорогу через URL', () => {
  const q = {
    ...emptyQuery(),
    directions: ['shahmaty', 'yazyki'],
    children: [{ age: 8, name: 'Маша' }, { age: 6, name: '' }],
    windows: normalizeWindows([
      ...[1, 2, 3, 4, 5].map((day) => ({ day, from: 1080, to: 1320 })),
      { day: 6, from: 540, to: 780 }
    ]),
    strict: true,
    geoMode: 'metro',
    stations: ['chkalovskaya', 'sportivnaya'],
    sort: 'price'
  };
  const back = parseQuery(queryToSearch(q));
  assert.deepEqual(back.directions, q.directions);
  assert.deepEqual(back.children, q.children);
  assert.deepEqual(back.windows, q.windows);
  assert.equal(back.strict, true);
  assert.equal(back.geoMode, 'metro');
  assert.deepEqual(back.stations, q.stations);
  assert.equal(back.sort, 'price');
});

test('мусор в URL не ломает разбор', () => {
  const q = parseQuery('?kids=abc,7,99&win=broken&geo=nowhere&sort=random&rad=-5');
  assert.deepEqual(q.children, [{ age: 7, name: '' }]);
  assert.deepEqual(q.windows, []);
  assert.equal(q.geoMode, 'off');
  assert.equal(q.sort, 'match');
  assert.equal(q.radius, 2000);
});

test('пустой запрос даёт пустую строку', () => {
  assert.equal(queryToSearch(emptyQuery()), '');
});

/* ── фасеты ──────────────────────────────────────────────────────────────── */

test('дельта фасета сходится с настоящим счётом', () => {
  const q = { ...emptyQuery(), geoMode: 'metro', stations: ['chkalovskaya'] };
  const base = countOnly(index, q);
  const info = facetCount(index, q, 'stations', 'sportivnaya', base);
  assert.equal(info.mode, 'delta');
  assert.equal(base + info.count, countOnly(index, { ...q, stations: ['chkalovskaya', 'sportivnaya'] }));
});

test('вклад единственной выбранной опции равен всему результату', () => {
  const q = { ...emptyQuery(), geoMode: 'metro', stations: ['chkalovskaya'] };
  const base = countOnly(index, q);
  const info = facetCount(index, q, 'stations', 'chkalovskaya', base);
  assert.equal(info.mode, 'contribution');
  assert.equal(info.count, base);
});

test('в пустом фасете число — это «сколько будет, если выбрать только это»', () => {
  const q = { ...emptyQuery(), geoMode: 'metro' };
  const base = countOnly(index, q);
  const info = facetCount(index, q, 'stations', 'chkalovskaya', base);
  assert.equal(info.mode, 'absolute');
  assert.equal(info.count, countOnly(index, { ...q, stations: ['chkalovskaya'] }));
});

/* ── подсказки ───────────────────────────────────────────────────────────── */

test('каждая подсказка обещает столько, сколько реально даёт', () => {
  const q = {
    ...emptyQuery(),
    directions: ['shahmaty'],
    children: [{ age: 8, name: '' }],
    windows: [1, 2, 3, 4, 5].map((day) => ({ day, from: 1080, to: GRID.dayEnd })),
    geoMode: 'metro',
    stations: ['petrogradskaya']
  };
  const list = suggestions(index, q);
  assert.ok(list.length > 0, 'при пустом результате должна быть хотя бы одна подсказка');
  for (const s of list) {
    assert.equal(countOnly(index, { ...q, ...s.patch }), s.count, `подсказка «${s.text}» врёт`);
    assert.ok(s.count > 0);
  }
});

test('на каждый фильтр не больше одной подсказки', () => {
  const q = {
    ...emptyQuery(),
    directions: ['plavanie'],
    children: [{ age: 13, name: '' }],
    windows: [1, 2, 3, 4, 5].map((day) => ({ day, from: 1200, to: GRID.dayEnd })),
    geoMode: 'district',
    districts: ['kolpinskiy']
  };
  const kinds = suggestions(index, q).map((s) => s.kind);
  assert.equal(kinds.length, new Set(kinds).size);
});

/* ── пресеты ─────────────────────────────────────────────────────────────── */

test('ни один пресет не даёт пустоты', () => {
  for (const p of PRESETS) {
    const n = countOnly(index, { ...emptyQuery(), windows: p.windows });
    assert.ok(n > 0, `пресет «${p.name}» ничего не находит`);
  }
});

/* ── обоих сразу ─────────────────────────────────────────────────────────── */

test('«обоих сразу» не предлагает занятия вне окна', () => {
  const q = {
    ...emptyQuery(),
    children: [{ age: 6, name: 'Гриша' }, { age: 9, name: 'Маша' }],
    windows: PRESETS[2].windows // только выходные
  };
  const res = search(index, q);
  const variants = togetherVariants(res.items, q, 20);
  assert.ok(variants.length > 0);
  for (const v of variants) {
    for (const e of v.entries) {
      assert.ok(e.lessons.length > 0);
      for (const l of e.lessons) {
        assert.ok(l.day === 6 || l.day === 7, `занятие в день ${l.day} при окне «только выходные»`);
        assert.ok(l.fits, 'занятие не попадает в окно');
      }
    }
  }
});

test('парный вариант покрывает обоих детей разными группами', () => {
  const q = {
    ...emptyQuery(),
    children: [{ age: 6, name: 'А' }, { age: 11, name: 'Б' }]
  };
  const res = search(index, q);
  const pairs = togetherVariants(res.items, q, 20).filter((v) => !v.single);
  assert.ok(pairs.length > 0, 'парные варианты вообще не находятся');
  for (const v of pairs) {
    assert.equal(v.entries.length, 2);
    assert.equal(v.entries[0].item.group.branchId, v.entries[1].item.group.branchId);
    const covered = new Set(v.entries.flatMap((e) => e.children));
    assert.deepEqual([...covered].sort(), [0, 1]);
  }
});

/* ── поиск целиком ───────────────────────────────────────────────────────── */

test('«почти подходит» — ровно плюс-минус год и не в основном списке', () => {
  const q = { ...emptyQuery(), children: [{ age: 8, name: '' }] };
  const res = search(index, q);
  const mainIds = new Set(res.items.map((i) => i.group.id));
  for (const it of res.almost) {
    assert.ok(!mainIds.has(it.group.id));
    const g = it.group;
    assert.ok(g.ageFrom === 9 || g.ageTo === 7, `${g.ageFrom}—${g.ageTo} не «почти» для 8 лет`);
  }
});

test('строгий режим — подмножество мягкого', () => {
  const q = { ...emptyQuery(), windows: PRESETS[0].windows };
  assert.ok(countOnly(index, { ...q, strict: true }) <= countOnly(index, q));
});

test('в режиме «рядом» расстояние не превышает радиус', () => {
  const q = { ...emptyQuery(), geoMode: 'near', point: { lat: 59.927, lon: 30.3199 }, radius: 2000 };
  const res = search(index, q);
  assert.ok(res.total > 0);
  for (const it of res.items) assert.ok(it.match.distance <= 2000);
});

test('usableLessons без окон отдаёт все занятия', () => {
  const g = index.groups[0];
  const item = { group: g, match: { lessons: g.lessons } };
  assert.equal(usableLessons(item).length, g.lessons.length);
});

/* ── данные ──────────────────────────────────────────────────────────────── */

test('каталог непротиворечив', () => {
  assert.ok(index.groups.length >= 250 && index.groups.length <= 350, `групп ${index.groups.length}`);
  const ids = new Set();
  for (const g of index.groups) {
    assert.ok(!ids.has(g.id), `повтор id ${g.id}`);
    ids.add(g.id);
    assert.ok(g.branch, `у ${g.id} нет филиала`);
    assert.ok(g.org, `у ${g.id} нет организации`);
    assert.ok(g.ageFrom < g.ageTo, `${g.id}: возраст ${g.ageFrom}—${g.ageTo}`);
    assert.ok(g.lessons.length >= 1 && g.lessons.length <= 3);
    for (const l of g.lessons) {
      assert.ok(l.day >= 1 && l.day <= 7);
      assert.ok(l.end > l.start);
      assert.ok(l.start >= GRID.dayStart && l.end <= GRID.dayEnd, `${g.id}: занятие вне сетки`);
    }
    assert.ok(g.priceMonth > 0 && g.priceSingle > 0);
  }
});

test('плавание есть только там, где есть бассейн', () => {
  const pools = new Set(catalog.branches.filter((b) => b.hasPool).map((b) => b.id));
  for (const g of index.groups) {
    if (g.direction === 'plavanie') assert.ok(pools.has(g.branchId), `${g.id} плавает без бассейна`);
  }
  assert.ok(pools.size <= 12, 'бассейнов слишком много для правдоподобия');
});

test('даты набора живут вокруг дня сборки, а не в прошлом году', () => {
  const now = new Date();
  for (const g of index.groups) {
    const d = new Date(`${g.intakeStart}T00:00:00`);
    const days = (d - now) / 86400000;
    assert.ok(days > -70 && days < 140, `${g.id}: ${g.intakeStart}`);
  }
});

test('ближайшая станция у филиала действительно ближайшая', () => {
  for (const b of catalog.branches.slice(0, 20)) {
    let best = null;
    let bestD = Infinity;
    for (const st of geo.stations) {
      const d = haversine(b.lat, b.lon, st.lat, st.lon);
      if (d < bestD) {
        bestD = d;
        best = st.id;
      }
    }
    assert.equal(b.stationId, best, `${b.address}: записана ${b.stationId}, ближе ${best}`);
    assert.ok(Math.abs(b.metroDistance - bestD) < 2);
  }
});
