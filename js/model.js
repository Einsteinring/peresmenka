// Ядро поиска. Чистый ES-модуль без DOM: этот же файл импортирует генератор
// статических страниц, поэтому браузер и сборка считают одним кодом и не могут
// разойтись в числах.

import { ageRange, groupsWord, plural, time, yearsWord, DAY_SHORT } from './format.js';

/* ── сетка времени ───────────────────────────────────────────────────────── */

export const GRID = {
  dayStart: 7 * 60,
  dayEnd: 22 * 60,
  step: 30,
  get cols() {
    return (this.dayEnd - this.dayStart) / this.step;
  },
  days: [1, 2, 3, 4, 5, 6, 7]
};

/* ── расстояние ──────────────────────────────────────────────────────────── */

export function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ── окна расписания ─────────────────────────────────────────────────────── */

// Окно — непрерывный отрезок одного дня. Маска сетки превращается в окна,
// окна — обратно в маску; логика фильтра работает только с окнами.

export function maskToWindows(mask) {
  const out = [];
  for (const day of GRID.days) {
    let from = null;
    for (let c = 0; c <= GRID.cols; c++) {
      const on = c < GRID.cols && mask[(day - 1) * GRID.cols + c] === 1;
      if (on && from === null) from = c;
      if (!on && from !== null) {
        out.push({ day, from: GRID.dayStart + from * GRID.step, to: GRID.dayStart + c * GRID.step });
        from = null;
      }
    }
  }
  return out;
}

export function windowsToMask(windows) {
  const mask = new Uint8Array(GRID.days.length * GRID.cols);
  for (const w of windows) {
    const a = Math.max(0, Math.round((w.from - GRID.dayStart) / GRID.step));
    const b = Math.min(GRID.cols, Math.round((w.to - GRID.dayStart) / GRID.step));
    for (let c = a; c < b; c++) mask[(w.day - 1) * GRID.cols + c] = 1;
  }
  return mask;
}

export function normalizeWindows(windows) {
  return maskToWindows(windowsToMask(windows));
}

// Сдвиг двигает окно целиком и не меняет его длину. Если упёрлись в край
// суток — сдвигаем на сколько можно: «сдвиньте окно на полчаса раньше»
// не должно втихую укоротить его до нуля.
export function shiftWindows(windows, deltaMinutes) {
  return normalizeWindows(
    windows.map((w) => {
      const room = deltaMinutes < 0
        ? -Math.min(-deltaMinutes, w.from - GRID.dayStart)
        : Math.min(deltaMinutes, GRID.dayEnd - w.to);
      return { day: w.day, from: w.from + room, to: w.to + room };
    })
  );
}

export function growWindows(windows, before, after) {
  return normalizeWindows(
    windows.map((w) => ({
      day: w.day,
      from: Math.max(GRID.dayStart, w.from - before),
      to: Math.min(GRID.dayEnd, w.to + after)
    }))
  );
}

function windowsByDay(windows) {
  const map = new Map();
  for (const w of windows) {
    if (!map.has(w.day)) map.set(w.day, []);
    map.get(w.day).push(w);
  }
  return map;
}

// Занятие подходит, только если целиком лежит внутри одного окна.
// Частичное пересечение — это не «подходит»: родитель не заберёт ребёнка
// из школы раньше.
export function lessonFit(lesson, byDay) {
  const list = byDay.get(lesson.day);
  if (!list || !list.length) return { fits: false, overhang: Infinity };
  let best = Infinity;
  for (const w of list) {
    if (w.from <= lesson.start && lesson.end <= w.to) return { fits: true, overhang: 0 };
    const over = Math.max(0, w.from - lesson.start) + Math.max(0, lesson.end - w.to);
    if (over < best) best = over;
  }
  return { fits: false, overhang: best };
}

export const PRESETS = [
  { id: 'after-school', name: 'После школы', windows: [1, 2, 3, 4, 5].map((day) => ({ day, from: 960, to: 1170 })) },
  { id: 'evening', name: 'Поздний вечер', windows: [1, 2, 3, 4, 5].map((day) => ({ day, from: 1080, to: 1260 })) },
  { id: 'weekend', name: 'Только выходные', windows: [6, 7].map((day) => ({ day, from: 540, to: 900 })) },
  { id: 'early', name: 'Раннее утро', windows: [6, 7].map((day) => ({ day, from: 480, to: 690 })) }
];

/* ── индекс ──────────────────────────────────────────────────────────────── */

export function buildIndex(catalog, geo) {
  const orgById = new Map(catalog.orgs.map((o) => [o.id, o]));
  const branchById = new Map(catalog.branches.map((b) => [b.id, b]));
  const directionById = new Map(catalog.directions.map((d) => [d.id, d]));
  const stationById = new Map(geo.stations.map((s) => [s.id, s]));
  const districtById = new Map(geo.districts.map((d) => [d.id, d]));

  const groups = catalog.groups.map((g) => {
    const branch = branchById.get(g.branchId);
    return {
      ...g,
      branch,
      org: orgById.get(g.orgId),
      dir: directionById.get(g.direction),
      station: stationById.get(branch.stationId),
      district: districtById.get(branch.districtId)
    };
  });

  // Соседи по линии плюс всё, что стоит ближе 900 м: пересадочные узлы
  // становятся соседями сами, вручную их перечислять не нужно.
  const stationNeighbours = new Map();
  for (const st of geo.stations) stationNeighbours.set(st.id, new Set());
  for (const line of geo.lines) {
    line.stations.forEach((id, i) => {
      if (i > 0) stationNeighbours.get(id).add(line.stations[i - 1]);
      if (i < line.stations.length - 1) stationNeighbours.get(id).add(line.stations[i + 1]);
    });
  }
  for (const a of geo.stations) {
    for (const b of geo.stations) {
      if (a.id !== b.id && haversine(a.lat, a.lon, b.lat, b.lon) <= 900) {
        stationNeighbours.get(a.id).add(b.id);
      }
    }
  }

  // Соседние районы выводим из центров тяжести филиалов, а не из списка руками.
  const centroids = new Map();
  for (const d of geo.districts) {
    const own = catalog.branches.filter((b) => b.districtId === d.id);
    if (!own.length) continue;
    centroids.set(d.id, [
      own.reduce((s, b) => s + b.lat, 0) / own.length,
      own.reduce((s, b) => s + b.lon, 0) / own.length
    ]);
  }
  const districtNeighbours = new Map();
  for (const [id, c] of centroids) {
    const near = [...centroids.entries()]
      .filter(([other]) => other !== id)
      .map(([other, oc]) => [other, haversine(c[0], c[1], oc[0], oc[1])])
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([other]) => other);
    districtNeighbours.set(id, near);
  }

  const linesByStation = new Map();
  for (const line of geo.lines) {
    for (const id of line.stations) {
      if (!linesByStation.has(id)) linesByStation.set(id, []);
      linesByStation.get(id).push(line.id);
    }
  }

  return {
    meta: catalog.meta,
    groups,
    byId: new Map(groups.map((g) => [g.id, g])),
    directions: catalog.directions,
    directionById,
    levels: catalog.levels,
    districts: geo.districts,
    districtById,
    stations: geo.stations,
    stationById,
    lines: geo.lines,
    linesByStation,
    places: geo.places,
    branchById,
    orgById,
    stationNeighbours,
    districtNeighbours
  };
}

/* ── запрос ──────────────────────────────────────────────────────────────── */

export function emptyQuery() {
  return {
    directions: [],
    children: [],
    windows: [],
    strict: false,
    geoMode: 'off',
    districts: [],
    stations: [],
    point: null,
    radius: 2000,
    sort: 'match'
  };
}

export function isEmptyQuery(q) {
  return (
    !q.directions.length &&
    !q.children.length &&
    !q.windows.length &&
    q.geoMode === 'off'
  );
}

function prepare(index, q) {
  return {
    byDay: windowsByDay(q.windows),
    hasWindows: q.windows.length > 0,
    dirSet: q.directions.length ? new Set(q.directions) : null,
    districtSet: q.districts.length ? new Set(q.districts) : null,
    stationSet: q.stations.length ? new Set(q.stations) : null,
    ref: refPoint(index, q)
  };
}

// Точка отсчёта для расстояний: своя позиция в режиме «рядом», единственная
// выбранная станция — в режиме метро. Иначе расстояние не показываем.
function refPoint(index, q) {
  if (q.geoMode === 'near' && q.point) return { lat: q.point.lat, lon: q.point.lon };
  if (q.geoMode === 'metro' && q.stations.length === 1) {
    const st = index.stationById.get(q.stations[0]);
    if (st) return { lat: st.lat, lon: st.lon };
  }
  return null;
}

/* ── возраст ─────────────────────────────────────────────────────────────── */

// Родителю важен не диапазон, а сколько лет ребёнок ещё проходит в этой группе.
export function ageNote(group, age) {
  const { ageFrom, ageTo } = group;
  if (age < ageFrom - 1 || age > ageTo + 1) return null;
  if (age === ageFrom - 1) {
    return { kind: 'younger', text: `младше на год: группа с ${ageFrom} ${plural(ageFrom, 'года', 'лет', 'лет')}` };
  }
  if (age === ageTo + 1) {
    return { kind: 'older', text: `старше на год: группа до ${ageTo} ${plural(ageTo, 'года', 'лет', 'лет')}` };
  }
  const headroom = ageTo - age;
  const width = ageTo - ageFrom;
  if (headroom === 0) {
    return { kind: 'last', text: `последний год по возрасту: группа до ${ageTo} ${plural(ageTo, 'года', 'лет', 'лет')}` };
  }
  if (headroom === 1) {
    return { kind: 'short', text: 'хватит ещё на год, потом нужна группа старше' };
  }
  if (age === ageFrom && width >= 3) {
    return { kind: 'youngest', text: `самый младший в группе ${ageRange(ageFrom, ageTo)}, впереди ${yearsWord(headroom)}` };
  }
  return {
    kind: 'middle',
    text: `в середине диапазона ${ageRange(ageFrom, ageTo)} — ещё ${yearsWord(headroom)} в этой группе`
  };
}

/* ── проверка одной группы ───────────────────────────────────────────────── */

export function matchGroup(g, q, pre) {
  const dirOk = !pre.dirSet || pre.dirSet.has(g.direction);

  const matched = [];
  const nearAge = [];
  if (q.children.length) {
    q.children.forEach((child, i) => {
      if (child.age >= g.ageFrom && child.age <= g.ageTo) matched.push(i);
      else if (child.age === g.ageFrom - 1 || child.age === g.ageTo + 1) nearAge.push(i);
    });
  }
  const ageOk = !q.children.length || matched.length > 0;

  let lessons = g.lessons;
  let fitCount = g.lessons.length;
  let schedOk = true;
  if (pre.hasWindows) {
    lessons = g.lessons.map((l) => {
      const f = lessonFit(l, pre.byDay);
      return { ...l, fits: f.fits, overhang: f.overhang };
    });
    fitCount = lessons.filter((l) => l.fits).length;
    schedOk = q.strict ? fitCount === lessons.length : fitCount > 0;
  }

  let geoOk = true;
  let distance = null;
  if (q.geoMode === 'district') {
    geoOk = !pre.districtSet || pre.districtSet.has(g.branch.districtId);
  } else if (q.geoMode === 'metro') {
    geoOk = !pre.stationSet || pre.stationSet.has(g.branch.stationId);
  } else if (q.geoMode === 'near') {
    if (q.point) {
      distance = haversine(q.point.lat, q.point.lon, g.branch.lat, g.branch.lon);
      geoOk = distance <= q.radius;
    }
  }
  if (distance === null && pre.ref) {
    distance = haversine(pre.ref.lat, pre.ref.lon, g.branch.lat, g.branch.lon);
  }

  return { dirOk, ageOk, schedOk, geoOk, matched, nearAge, lessons, fitCount, distance };
}

/* ── поиск ───────────────────────────────────────────────────────────────── */

const daysUntil = (isoDate, now) => {
  const start = new Date(`${isoDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((start - today) / 86400000));
};

function sortItems(items, q, now) {
  const byPrice = (a, b) => a.group.priceMonth - b.group.priceMonth;
  if (q.sort === 'price') items.sort(byPrice);
  else if (q.sort === 'distance') {
    items.sort((a, b) => {
      const da = a.match.distance ?? Infinity;
      const db = b.match.distance ?? Infinity;
      return da - db || byPrice(a, b);
    });
  } else if (q.sort === 'intake') {
    items.sort(
      (a, b) =>
        daysUntil(a.group.intakeStart, now) - daysUntil(b.group.intakeStart, now) || byPrice(a, b)
    );
  } else {
    // «по совпадению»: сперва те, у кого в окно попало больше занятий,
    // потом те, кому подходит больше детей, потом ближе и дешевле.
    items.sort(
      (a, b) =>
        b.match.fitCount - a.match.fitCount ||
        b.match.matched.length - a.match.matched.length ||
        (a.match.distance ?? Infinity) - (b.match.distance ?? Infinity) ||
        byPrice(a, b)
    );
  }
  return items;
}

export function search(index, q, now = new Date()) {
  const pre = prepare(index, q);
  const items = [];
  const almost = [];
  for (const g of index.groups) {
    const m = matchGroup(g, q, pre);
    if (!m.dirOk || !m.schedOk || !m.geoOk) continue;
    if (m.ageOk) items.push({ group: g, match: m });
    else if (m.nearAge.length) almost.push({ group: g, match: m });
  }
  sortItems(items, q, now);
  sortItems(almost, q, now);
  return { items, almost, total: items.length, almostTotal: almost.length };
}

// Быстрый счётчик без сортировки и без сборки массивов: им пользуются фасеты
// и подсказки, поэтому он вызывается сотнями за одно нажатие.
export function countOnly(index, q) {
  const pre = prepare(index, q);
  let n = 0;
  for (const g of index.groups) {
    const m = matchGroup(g, q, pre);
    if (m.dirOk && m.ageOk && m.schedOk && m.geoOk) n++;
  }
  return n;
}

/* ── фасеты ──────────────────────────────────────────────────────────────── */

// Одно правило на весь сайт:
//   опция выбрана          → сколько результатов держится на ней одной;
//   в фасете пусто         → сколько будет, если выбрать только её;
//   в фасете что-то есть   → сколько ДОБАВИТСЯ, если выбрать ещё и её.
// Панель пустого результата берёт числа отсюда же, поэтому «+4» у чекбокса
// и «ещё 4 группы» в подсказке — это один и тот же вызов.
export function facetCount(index, q, dim, value, base) {
  const current = q[dim];
  if (current.includes(value)) {
    // Снять единственную выбранную опцию — это не «убавить», а выключить
    // фильтр целиком: на ней держится весь результат.
    if (current.length === 1) return { count: base, mode: 'contribution', selected: true };
    const without = countOnly(index, { ...q, [dim]: current.filter((v) => v !== value) });
    return { count: base - without, mode: 'contribution', selected: true };
  }
  if (!current.length) {
    return { count: countOnly(index, { ...q, [dim]: [value] }), mode: 'absolute', selected: false };
  }
  return {
    count: countOnly(index, { ...q, [dim]: [...current, value] }) - base,
    mode: 'delta',
    selected: false
  };
}

export function facets(index, q) {
  const base = countOnly(index, q);
  const out = { base, directions: new Map(), districts: new Map(), stations: new Map() };
  for (const d of index.directions) {
    out.directions.set(d.id, facetCount(index, q, 'directions', d.id, base));
  }
  if (q.geoMode === 'district') {
    for (const d of index.districts) {
      out.districts.set(d.id, facetCount(index, q, 'districts', d.id, base));
    }
  }
  if (q.geoMode === 'metro') {
    for (const s of index.stations) {
      out.stations.set(s.id, facetCount(index, q, 'stations', s.id, base));
    }
  }
  return out;
}

/* ── подсказки, когда ничего не нашлось ──────────────────────────────────── */

// Под каждое предложение реально прогоняется фильтр: показанное число —
// настоящее, а не оценка.
export function suggestions(index, q) {
  const base = countOnly(index, q);
  const out = [];
  const add = (kind, patch, text) => {
    const count = countOnly(index, { ...q, ...patch });
    if (count > base) out.push({ kind, patch, count, delta: count - base, text });
  };

  /* расписание */
  if (q.windows.length) {
    const sched = [];
    const trySched = (patch, text) => {
      const count = countOnly(index, { ...q, ...patch });
      if (count > base) sched.push({ kind: 'schedule', patch, count, delta: count - base, text });
    };
    trySched({ windows: shiftWindows(q.windows, -30) }, 'Сдвиньте окно на полчаса раньше');
    trySched({ windows: shiftWindows(q.windows, -60) }, 'Сдвиньте окно на час раньше');
    trySched({ windows: shiftWindows(q.windows, 30) }, 'Сдвиньте окно на полчаса позже');
    trySched({ windows: shiftWindows(q.windows, 60) }, 'Сдвиньте окно на час позже');
    trySched({ windows: growWindows(q.windows, 30, 0) }, 'Начните окно на полчаса раньше');
    trySched({ windows: growWindows(q.windows, 0, 30) }, 'Продлите окно на полчаса вечером');
    trySched({ windows: growWindows(q.windows, 30, 30) }, 'Расширьте окно на полчаса с обеих сторон');
    sched.sort((a, b) => b.count - a.count);
    if (sched[0]) out.push(sched[0]);
  }
  if (q.strict && q.windows.length) {
    add('strict', { strict: false }, 'Не требуйте, чтобы все занятия попадали в окно');
  }

  /* возраст */
  if (q.children.length === 1) {
    const age = q.children[0].age;
    const already = new Set(search(index, q).items.map((i) => i.group.id));
    const tries = [];
    for (let a = 3; a <= 17; a++) {
      if (a === age) continue;
      const patch = { children: [{ ...q.children[0], age: a }] };
      const res = search(index, { ...q, ...patch });
      if (res.total <= base) continue;
      // Описываем только те группы, которых при нынешнем возрасте нет:
      // иначе диапазон в подсказке накрывает уже найденное и выглядит враньём.
      const added = res.items.filter((i) => !already.has(i.group.id));
      if (!added.length) continue;
      const from = Math.min(...added.map((i) => i.group.ageFrom));
      const to = Math.max(...added.map((i) => i.group.ageTo));
      const years = plural(age, 'года', 'лет', 'лет');
      const text =
        base === 0
          ? `Для ${age} ${years} здесь ничего нет, а для ${a} — ${groupsWord(added.length)} ${ageRange(from, to)}`
          : `Для ${a} ${plural(a, 'года', 'лет', 'лет')} нашлось бы больше: ${groupsWord(res.total)} вместо ${base}`;
      tries.push({
        kind: 'age',
        patch,
        count: res.total,
        delta: res.total - base,
        text,
        rank: added.length - Math.abs(a - age) * 0.5
      });
    }
    tries.sort((a, b) => b.rank - a.rank);
    if (tries[0]) out.push(tries[0]);
  } else if (q.children.length > 1) {
    q.children.forEach((child, i) => {
      const rest = q.children.filter((_, j) => j !== i);
      add('age', { children: rest }, `Искать без ${child.name || `ребёнка ${child.age} ${plural(child.age, 'года', 'лет', 'лет')}`}`);
    });
  }

  /* география */
  if (q.geoMode === 'metro' && q.stations.length) {
    const geo = [];
    const seen = new Set(q.stations);
    for (const id of q.stations) {
      for (const nb of index.stationNeighbours.get(id) || []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const patch = { stations: [...q.stations, nb] };
        const count = countOnly(index, { ...q, ...patch });
        if (count > base) {
          geo.push({
            kind: 'geo',
            patch,
            count,
            delta: count - base,
            text: `Добавьте соседнюю станцию «${index.stationById.get(nb).name}»`
          });
        }
      }
    }
    geo.sort((a, b) => b.delta - a.delta);
    // Соседи не помогли и результат пуст — ищем ближайшую станцию, где это
    // вообще есть. Для родителя «ехать некуда» хуже, чем «ехать 3 км».
    if (!geo.length && base === 0) {
      const origin = index.stationById.get(q.stations[0]);
      let best = null;
      for (const st of index.stations) {
        if (q.stations.includes(st.id)) continue;
        const count = countOnly(index, { ...q, stations: [st.id] });
        if (!count) continue;
        const away = haversine(origin.lat, origin.lon, st.lat, st.lon);
        if (!best || away < best.away) best = { st, count, away };
      }
      if (best) {
        geo.push({
          kind: 'geo',
          patch: { stations: [best.st.id] },
          count: best.count,
          delta: best.count,
          text: `Ближайшее место, где это есть, — «${best.st.name}», ${(best.away / 1000).toFixed(1).replace('.', ',')} км отсюда`
        });
      }
    }
    if (geo[0]) out.push(geo[0]);
  } else if (q.geoMode === 'district' && q.districts.length) {
    const geo = [];
    const seen = new Set(q.districts);
    for (const id of q.districts) {
      for (const nb of index.districtNeighbours.get(id) || []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const patch = { districts: [...q.districts, nb] };
        const count = countOnly(index, { ...q, ...patch });
        if (count > base) {
          geo.push({
            kind: 'geo',
            patch,
            count,
            delta: count - base,
            text: `Добавьте соседний район — ${index.districtById.get(nb).name}`
          });
        }
      }
    }
    geo.sort((a, b) => b.delta - a.delta);
    if (geo[0]) out.push(geo[0]);
  } else if (q.geoMode === 'near' && q.point) {
    const geo = [];
    for (const r of [q.radius + 1000, q.radius + 2000, q.radius + 3000]) {
      const count = countOnly(index, { ...q, radius: r });
      if (count > base) {
        geo.push({
          kind: 'geo',
          patch: { radius: r },
          count,
          delta: count - base,
          text: `Возьмите радиус ${(r / 1000).toString().replace('.', ',')} км вместо ${(q.radius / 1000).toString().replace('.', ',')}`
        });
      }
    }
    if (geo[0]) out.push(geo[0]);
  }

  /* направление */
  if (q.directions.length === 1) {
    add('direction', { directions: [] }, 'Снимите фильтр по направлению');
  } else if (q.directions.length > 1) {
    add('direction', { directions: [] }, 'Снимите фильтр по направлениям');
  }

  // Отдельная ось: не «ослабить географию», а убрать её совсем. Показываем
  // только когда результат пуст, иначе она перебила бы точечные подсказки
  // своим заведомо большим числом.
  if (base === 0 && q.geoMode !== 'off') {
    add('city', { geoMode: 'off' }, 'Посмотреть по всему городу');
  }

  // одно предложение на фильтр, самое результативное сверху
  const best = new Map();
  for (const s of out) {
    const prev = best.get(s.kind);
    if (!prev || s.count > prev.count) best.set(s.kind, s);
  }
  // «По всему городу» всегда последней: её число больше любого точечного,
  // но совет она даёт самый грубый.
  return [...best.values()].sort(
    (a, b) => Number(a.kind === 'city') - Number(b.kind === 'city') || b.count - a.count
  );
}

/* ── «обоих в одно время» ────────────────────────────────────────────────── */

// Две группы годятся «на обоих сразу», если они в одном филиале и в один
// день идут одновременно или начинаются в пределах 20 минут: родитель
// приезжает один раз и ждёт один раз.
// Занятия, которые реально годятся: если окно задано — только попавшие в него.
// Иначе в «обоих сразу» попадает вторник при окне «выходные».
export function usableLessons(item) {
  const marked = item.match.lessons.some((l) => 'fits' in l);
  return marked ? item.match.lessons.filter((l) => l.fits) : item.match.lessons;
}

function sameTrip(a, b) {
  for (const la of usableLessons(a)) {
    for (const lb of usableLessons(b)) {
      if (la.day !== lb.day) continue;
      const overlap = la.start < lb.end && lb.start < la.end;
      if (overlap || Math.abs(la.start - lb.start) <= 20) {
        return { day: la.day, from: Math.min(la.start, lb.start), to: Math.max(la.end, lb.end) };
      }
    }
  }
  return null;
}

export function togetherVariants(items, q, limit = 8) {
  if (q.children.length < 2) return [];
  const all = q.children.map((_, i) => i);
  const byBranch = new Map();
  for (const it of items) {
    if (!byBranch.has(it.group.branchId)) byBranch.set(it.group.branchId, []);
    byBranch.get(it.group.branchId).push(it);
  }

  const singles = [];
  const pairs = [];

  for (const [, list] of byBranch) {
    // одна группа берёт обоих
    for (const it of list) {
      if (!all.every((i) => it.match.matched.includes(i))) continue;
      const lessons = usableLessons(it);
      if (!lessons.length) continue;
      singles.push({
        branch: it.group.branch,
        org: it.group.org,
        entries: [{ item: it, children: [...it.match.matched], lessons }],
        single: true,
        price: it.group.priceMonth
      });
    }
    // две группы в одно время
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const covered = new Set([...a.match.matched, ...b.match.matched]);
        if (!all.every((c) => covered.has(c))) continue;
        // каждому ребёнку нужна своя группа, иначе это не «обоих сразу»
        const onlyA = all.filter((c) => a.match.matched.includes(c));
        const onlyB = all.filter((c) => b.match.matched.includes(c) && !onlyA.includes(c));
        if (!onlyA.length || !onlyB.length) continue;
        const trip = sameTrip(a, b);
        if (!trip) continue;
        pairs.push({
          branch: a.group.branch,
          org: a.group.org,
          entries: [
            { item: a, children: onlyA, lessons: usableLessons(a).filter((l) => l.day === trip.day) },
            { item: b, children: onlyB, lessons: usableLessons(b).filter((l) => l.day === trip.day) }
          ],
          trip,
          single: false,
          price: a.group.priceMonth + b.group.priceMonth
        });
      }
    }
  }

  const byPrice = (a, b) => a.price - b.price;
  singles.sort(byPrice);
  pairs.sort(byPrice);
  const half = Math.ceil(limit / 2);
  // Пары не должны тонуть под одиночными: у них своя ценность — два разных
  // кружка в одно время, пока родитель ждёт один раз.
  const takeSingles = Math.min(singles.length, Math.max(half, limit - pairs.length));
  return [...singles.slice(0, takeSingles), ...pairs.slice(0, limit - takeSingles)];
}

/* ── вспомогательное для страниц ─────────────────────────────────────────── */

export function priceStats(groups) {
  const prices = groups.map((g) => g.priceMonth).sort((a, b) => a - b);
  return {
    min: prices[0],
    max: prices[prices.length - 1],
    median: prices[Math.floor(prices.length / 2)]
  };
}

export function scheduleSummary(group) {
  return group.lessons.map((l) => `${DAY_SHORT[l.day]} ${time(l.start)}—${time(l.end)}`).join(', ');
}
