// Живой поиск. Состояние одно: объект запроса. Всё остальное — его отражение
// в URL, в контролах и в списке. Ни одной кнопки «Найти».

import {
  buildIndex, countOnly, emptyQuery, facets, search, suggestions, togetherVariants,
  PRESETS, GRID
} from './model.js';
import { parseQuery, queryToSearch } from './state.js';
import { createGrid, createList, describeWindows } from './grid.js';
import { groupCard, suggestionList, togetherCard, esc, groupUrl } from './render.js';
import { dirIcon, emptyArt } from './visual.js';
import { distance, groupsWord, plural, price, span, DAY_SHORT, time } from './format.js';
import { favIds, saveCurrentSearch, toggleFav } from './account.js';
import { loginPanel, mountTopbar } from './topbar.js';

const $ = (id) => document.getElementById(id);
const PAGE = 30;

let index = null;
let q = emptyQuery();
let grid = null;
let list = null;
let shown = PAGE;
let lastSuggestions = [];
const compare = new Set();
let geoAsked = false;

/* ── загрузка ────────────────────────────────────────────────────────────── */

async function boot() {
  const [catalog, geo] = await Promise.all([
    fetch('/data/catalog.json').then((r) => r.json()),
    fetch('/data/geo.json').then((r) => r.json())
  ]);
  index = buildIndex(catalog, geo);
  q = parseQuery(location.search);

  buildDirections();
  buildPresets();
  buildGeoLists();
  buildPlaces();

  grid = createGrid($('grid'), (windows) => apply({ windows }, 'push'));
  list = createList($('alt-body'), () => q.windows, (windows) => apply({ windows }, 'push'));

  wireControls();
  window.addEventListener('popstate', () => {
    q = parseQuery(location.search);
    shown = PAGE;
    syncControls();
    renderAll();
  });

  syncControls();
  renderAll();

  // Кабинет подключается после того, как поиск уже работает: он ничего
  // не загораживает и ничего не ждёт.
  mountTopbar($('topme'), {
    onState(state) {
      followed = state.user ? new Set((state.favs || []).map((f) => f.id)) : null;
      paintFollowed();
    }
  });
  mountSaveBar();
}

/* ── сохранить поиск и отслеживать группу ────────────────────────────────── */

// Гостю ничего не запрещается: панель с объяснением раскрывается под панелью
// результатов, поиск продолжает работать.
let followed = null;

// Панель всегда одна: вторая причина заменяет первую, а не закрывает её.
function offerLogin(reason) {
  const slot = $('saveslot');
  slot.textContent = '';
  slot.append(loginPanel(reason));
  slot.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

function mountSaveBar() {
  const bar = $('savebar');
  bar.innerHTML = '<button type="button" class="btn btn--gold" id="save-search">Сохранить поиск</button><span class="savebar__msg" id="save-msg"></span>';
  $('save-search').addEventListener('click', async () => {
    const search = queryToSearch(q);
    if (!search) {
      $('save-msg').textContent = 'Сначала задайте хотя бы один фильтр.';
      return;
    }
    try {
      await saveCurrentSearch(search);
      $('save-msg').innerHTML = 'Сохранено. <a href="/lk/?tab=saves">Открыть кабинет</a>';
    } catch (err) {
      if (err.status === 401) return offerLogin('Чтобы сохранить поиск и узнать о новых группах, нужен вход.');
      $('save-msg').textContent = err.message;
    }
  });
}

async function refreshFollowed() {
  followed = await favIds().catch(() => null);
  paintFollowed();
}

function paintFollowed() {
  for (const b of document.querySelectorAll('[data-follow]')) {
    const on = Boolean(followed && followed.has(b.dataset.follow));
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Отслеживается' : 'Отслеживать';
  }
}

/* ── изменение состояния ─────────────────────────────────────────────────── */

function apply(patch, history = 'push') {
  q = { ...q, ...patch };
  shown = PAGE;
  const url = `${location.pathname}${queryToSearch(q)}`;
  if (history === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
  syncControls();
  renderAll();
}

function toggle(dim, value) {
  const has = q[dim].includes(value);
  apply({ [dim]: has ? q[dim].filter((v) => v !== value) : [...q[dim], value] });
}

/* ── контролы ────────────────────────────────────────────────────────────── */

function buildDirections() {
  // Два вида одного фильтра, и они никогда не видны одновременно:
  // витрина плиток работает на широком экране, компактные чипы — в шторке.
  const chips = $('dirs');
  const tiles = $('tiles');
  for (const d of index.directions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.dir = d.id;
    b.innerHTML = `<span class="dot" data-dir="${esc(d.id)}"></span>${esc(d.short)} <span class="chip__n"></span>`;
    b.addEventListener('click', () => toggle('directions', d.id));
    chips.append(b);

    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'tile';
    t.dataset.dir = d.id;
    t.innerHTML = `${dirIcon(d.id, 26)}<span class="tile__name">${esc(d.short)}</span><span class="tile__n"></span>`;
    t.addEventListener('click', () => toggle('directions', d.id));
    tiles.append(t);
  }
}

function buildPresets() {
  const box = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.preset = p.id;
    b.innerHTML = `${esc(p.name)} <span class="chip__n"></span>`;
    b.addEventListener('click', () => {
      const same = describeWindows(q.windows) === describeWindows(p.windows);
      apply({ windows: same ? [] : p.windows.map((w) => ({ ...w })) });
    });
    box.append(b);
  }
}

function buildGeoLists() {
  const metro = $('metro-list');
  for (const line of index.lines) {
    const head = document.createElement('p');
    head.className = 'geo__line';
    head.innerHTML = `<span class="geo__dot" style="background:${line.color}"></span>${esc(line.name)}`;
    metro.append(head);
    const seen = new Set();
    for (const id of line.stations) {
      if (seen.has(id)) continue;
      seen.add(id);
      const st = index.stationById.get(id);
      metro.append(optionRow('stations', st.id, st.name));
    }
  }

  const districts = $('district-list');
  for (const d of [...index.districts].sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
    districts.append(optionRow('districts', d.id, d.name));
  }
}

function optionRow(dim, value, name) {
  const label = document.createElement('label');
  label.className = 'opt';
  label.dataset.dim = dim;
  label.dataset.value = value;
  label.innerHTML = `<input type="checkbox"><span class="opt__name">${esc(name)}</span><span class="opt__n"></span>`;
  label.querySelector('input').addEventListener('change', () => toggle(dim, value));
  return label;
}

function buildPlaces() {
  const dl = $('places');
  const seen = new Set();
  for (const st of index.stations) {
    if (seen.has(st.name)) continue;
    seen.add(st.name);
    const o = document.createElement('option');
    o.value = `метро ${st.name}`;
    dl.append(o);
  }
  for (const p of index.places) {
    const o = document.createElement('option');
    o.value = p.name;
    dl.append(o);
  }
}

function findPlace(text) {
  const clean = text.trim().replace(/^метро\s+/i, '').toLowerCase();
  if (!clean) return null;
  const coords = clean.match(/^(-?\d+[.,]\d+)\s*,\s*(-?\d+[.,]\d+)$/);
  if (coords) {
    return {
      lat: Number(coords[1].replace(',', '.')),
      lon: Number(coords[2].replace(',', '.')),
      label: text.trim()
    };
  }
  const st = index.stations.find((s) => s.name.toLowerCase() === clean)
    || index.stations.find((s) => s.name.toLowerCase().startsWith(clean));
  if (st) return { lat: st.lat, lon: st.lon, label: `метро ${st.name}` };
  const pl = index.places.find((p) => p.name.toLowerCase() === clean)
    || index.places.find((p) => p.name.toLowerCase().startsWith(clean));
  if (pl) return { lat: pl.lat, lon: pl.lon, label: pl.name };
  return null;
}

function wireControls() {
  $('add-kid').addEventListener('click', () => {
    const ages = [...q.children, { age: 8, name: '' }];
    apply({ children: ages });
    const inputs = $('kids').querySelectorAll('.kid__age');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $('modes').addEventListener('change', (e) => {
    const mode = e.target.value;
    apply({ geoMode: mode, sort: mode === 'near' && q.sort === 'match' ? 'distance' : q.sort });
  });

  $('metro-search').addEventListener('input', (e) => {
    const text = e.target.value.trim().toLowerCase();
    for (const label of $('metro-list').querySelectorAll('.opt')) {
      const name = label.querySelector('.opt__name').textContent.toLowerCase();
      label.hidden = Boolean(text) && !name.includes(text);
    }
    for (const head of $('metro-list').querySelectorAll('.geo__line')) {
      let next = head.nextElementSibling;
      let any = false;
      while (next && next.classList.contains('opt')) {
        if (!next.hidden) any = true;
        next = next.nextElementSibling;
      }
      head.hidden = !any;
    }
  });

  $('locate').addEventListener('click', locate);

  $('place').addEventListener('change', (e) => {
    const found = findPlace(e.target.value);
    if (found) {
      $('geo-msg').textContent = '';
      apply({ point: found, geoMode: 'near', sort: q.sort === 'match' ? 'distance' : q.sort });
    } else if (e.target.value.trim()) {
      $('geo-msg').textContent = 'Такого места нет в демо-справочнике. Попробуйте станцию метро или крупную улицу.';
    }
  });

  const radius = $('radius');
  radius.addEventListener('input', () => {
    $('radius-out').textContent = `${(Number(radius.value) / 1000).toString().replace('.', ',')} км`;
  });
  radius.addEventListener('change', () => apply({ radius: Number(radius.value) }));

  $('sort').addEventListener('change', (e) => apply({ sort: e.target.value }));
  $('strict').addEventListener('change', (e) => apply({ strict: e.target.checked }));
  $('reset').addEventListener('click', () => apply(emptyQuery()));

  $('open-filters').addEventListener('click', () => {
    $('builder').dataset.sheet = 'open';
    $('sheet-close').focus();
  });
  const closeSheet = () => {
    $('builder').dataset.sheet = 'closed';
    $('open-filters').focus();
  };
  $('sheet-close').addEventListener('click', closeSheet);
  $('apply-filters').addEventListener('click', closeSheet);

  // Ниже 768 px сетки нет, и список окон там не «дополнительно», а сам
  // редактор: держим его раскрытым, иначе половина фильтра прячется
  // за строкой, которой на этом экране даже не видно.
  const narrow = window.matchMedia('(max-width: 47.99rem)');
  const syncAlt = () => {
    if (narrow.matches) $('alt').open = true;
  };
  narrow.addEventListener('change', syncAlt);
  syncAlt();

  $('results').addEventListener('click', onResultsClick);
  $('results').addEventListener('change', onResultsChange);

  $('cmp-clear').addEventListener('click', () => {
    compare.clear();
    renderAll();
  });
  $('cmp-open').addEventListener('click', openCompare);
  $('cmp-close').addEventListener('click', () => $('cmpdlg').close());
}

function locate() {
  if (!navigator.geolocation) {
    $('geo-msg').textContent = 'Браузер не умеет определять место. Выберите метро или введите адрес.';
    return;
  }
  if (geoAsked) return;
  geoAsked = true;
  $('geo-msg').textContent = 'Определяем…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      geoAsked = false;
      $('geo-msg').textContent = '';
      apply({
        point: { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'моё место' },
        geoMode: 'near',
        sort: q.sort === 'match' ? 'distance' : q.sort
      });
    },
    () => {
      // Отказали — сказали один раз и отошли. Повторно не спрашиваем.
      geoAsked = false;
      $('geo-msg').textContent = 'Место не определилось. Выберите станцию метро или введите адрес — работает так же.';
      $('locate').disabled = true;
      $('place').focus();
    },
    { timeout: 8000, maximumAge: 300000 }
  );
}

/* ── синхронизация контролов с состоянием ────────────────────────────────── */

function syncControls() {
  // дети
  const kids = $('kids');
  kids.textContent = '';
  q.children.forEach((child, i) => {
    const row = document.createElement('div');
    row.className = 'kid';

    const age = document.createElement('input');
    age.type = 'number';
    age.className = 'kid__age num';
    age.min = '2';
    age.max = '18';
    age.value = String(child.age);
    age.setAttribute('aria-label', `Возраст ребёнка ${i + 1}`);
    age.addEventListener('change', () => {
      const value = Math.min(18, Math.max(2, Number(age.value) || child.age));
      const next = q.children.map((c, j) => (j === i ? { ...c, age: value } : c));
      apply({ children: next });
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'kid__name';
    name.placeholder = 'Имя, необязательно';
    name.value = child.name || '';
    name.setAttribute('aria-label', `Имя ребёнка ${i + 1}`);
    name.addEventListener('change', () => {
      const next = q.children.map((c, j) => (j === i ? { ...c, name: name.value.trim() } : c));
      apply({ children: next }, 'replace');
    });

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'kid__drop';
    drop.textContent = 'Убрать';
    drop.setAttribute('aria-label', `Убрать ребёнка ${i + 1}`);
    drop.addEventListener('click', () => apply({ children: q.children.filter((_, j) => j !== i) }));

    row.append(age, name, drop);
    kids.append(row);
  });
  $('add-kid').hidden = q.children.length >= 4;
  $('add-kid').textContent = q.children.length ? 'Добавить ещё ребёнка' : 'Указать возраст';

  const noKids = $('no-kids');
  const empty = q.children.length === 0;
  noKids.hidden = !empty;
  $('who-hint').hidden = empty;
  if (empty && !noKids.dataset.filled) {
    noKids.dataset.filled = '1';
    noKids.innerHTML = `${emptyArt('age')}<p>Возраст не задан. Укажите, сколько лет ребёнку, — и в каждой карточке будет видно, сколько лет он ещё проходит в этой группе.</p>`;
  }

  // режимы географии
  for (const input of $('modes').querySelectorAll('input')) {
    input.checked = input.value === q.geoMode;
  }
  $('geo-metro').hidden = q.geoMode !== 'metro';
  $('geo-district').hidden = q.geoMode !== 'district';
  $('geo-near').hidden = q.geoMode !== 'near';

  for (const label of document.querySelectorAll('.opt')) {
    const on = q[label.dataset.dim].includes(label.dataset.value);
    label.querySelector('input').checked = on;
  }

  if (q.point && $('place').value.trim() === '') $('place').value = q.point.label || '';
  $('radius').value = String(q.radius);
  $('radius-out').textContent = `${(q.radius / 1000).toString().replace('.', ',')} км`;

  $('sort').value = q.sort;
  $('strict').checked = q.strict;
  $('strict').closest('.strictbox').hidden = q.windows.length === 0;

  if (grid) grid.setWindows(q.windows);
  if (list) list.render();
  $('win-text').textContent = describeWindows(q.windows);

  for (const b of $('presets').querySelectorAll('[data-preset]')) {
    const preset = PRESETS.find((p) => p.id === b.dataset.preset);
    b.setAttribute('aria-pressed', describeWindows(q.windows) === describeWindows(preset.windows) ? 'true' : 'false');
  }
}

/* ── числа у опций ───────────────────────────────────────────────────────── */

function renderFacets() {
  const f = facets(index, q);

  for (const b of document.querySelectorAll('.chip[data-dir], .tile[data-dir]')) {
    const info = f.directions.get(b.dataset.dir);
    if (!info) continue;
    b.setAttribute('aria-pressed', info.selected ? 'true' : 'false');
    b.dataset.zero = info.count === 0 && !info.selected ? '1' : '0';
    const text = info.mode === 'delta' && info.count > 0 ? `+${info.count}` : String(info.count);
    const out = b.querySelector('.chip__n, .tile__n');
    out.textContent = text;
    out.title = facetTitle(info);
  }

  for (const b of $('presets').querySelectorAll('[data-preset]')) {
    const preset = PRESETS.find((p) => p.id === b.dataset.preset);
    const n = countOnly(index, { ...q, windows: preset.windows });
    b.querySelector('.chip__n').textContent = String(n);
    b.dataset.zero = n === 0 ? '1' : '0';
  }

  const dim = q.geoMode === 'metro' ? 'stations' : q.geoMode === 'district' ? 'districts' : null;
  if (dim) {
    const source = dim === 'stations' ? f.stations : f.districts;
    for (const label of document.querySelectorAll(`.opt[data-dim="${dim}"]`)) {
      const info = source.get(label.dataset.value);
      if (!info) continue;
      const text = info.mode === 'delta' && info.count > 0 ? `+${info.count}` : String(info.count);
      const out = label.querySelector('.opt__n');
      out.textContent = text;
      out.title = facetTitle(info);
      label.dataset.zero = info.count === 0 && !info.selected ? '1' : '0';
    }
  }
}

function facetTitle(info) {
  if (info.selected) return 'столько результатов держится на этом выборе';
  if (info.mode === 'delta') return 'столько добавится, если выбрать ещё и это';
  return 'столько будет, если выбрать только это';
}

/* ── результаты ──────────────────────────────────────────────────────────── */

function renderAll() {
  const res = search(index, q);
  const box = $('results');
  const parts = [];

  $('count').innerHTML = res.total
    ? `<span class="num">${res.total}</span> ${plural(res.total, 'группа', 'группы', 'групп')}`
    : 'Ничего не нашлось';
  $('mobile-count').textContent = String(res.total);
  $('apply-count').textContent = res.total
    ? `${res.total} ${plural(res.total, 'группу', 'группы', 'групп')}`
    : 'результат';

  if (!res.total) {
    lastSuggestions = suggestions(index, q);
    parts.push(emptyBlock(res));
  } else {
    let hasTogether = false;
    if (q.children.length > 1) {
      const together = togetherVariants(res.items, q);
      if (together.length) {
        hasTogether = true;
        parts.push(`<div class="group-head">
          <h2>Обоих в одно время и в одном месте — ${together.length}</h2>
          <p>Одна поездка вместо двух: либо группа берёт обоих, либо занятия идут параллельно в одном филиале.</p>
        </div>`);
        parts.push(together.map((v) => togetherCard(v, q.children)).join(''));
      }
    }

    const page = res.items.slice(0, shown);
    // Заголовок нужен только чтобы отделить общий список от блока «обоих
    // сразу»; иначе он повторяет счётчик в липкой панели.
    if (hasTogether) parts.push('<div class="group-head"><h2>Все подходящие группы</h2></div>');
    parts.push(page.map((it) => groupCard(it, { children: q.children, windows: q.windows, compared: compare.has(it.group.id) })).join(''));
    if (res.items.length > shown) {
      parts.push(`<button type="button" class="btn btn--quiet more" id="more">Показать ещё ${Math.min(PAGE, res.items.length - shown)}</button>`);
    }
  }

  if (res.almost.length) {
    parts.push(`<details class="almost"${res.total ? '' : ' open'}>
      <summary class="group-head"><h2 style="display:inline">Почти подходит — ${res.almost.length}</h2>
      <p>Ребёнок младше или старше на год. Часто берут, если позвонить.</p></summary>
      <div class="almost__body">${res.almost
        .slice(0, 20)
        .map((it) => groupCard(it, { children: q.children, windows: q.windows, compared: compare.has(it.group.id) }))
        .join('')}</div>
    </details>`);
  }

  box.innerHTML = parts.join('');
  renderFacets();
  renderCompareBar();
  paintFollowed();
}

function emptyBlock(res) {
  const lines = [];
  lines.push(`<div class="empty">${emptyArt('nothing')}<h2>Под эти условия ничего нет</h2>`);

  if (lastSuggestions.length) {
    lines.push('<p>Вот что изменит результат. Числа настоящие: каждое условие мы прогнали через поиск.</p>');
    lines.push(suggestionList(lastSuggestions));
  } else {
    const all = countOnly(index, emptyQuery());
    lines.push(`<p>Ослабить нечего: ни одно изменение одного фильтра не даёт результата. Во всём каталоге ${groupsWord(all)} — попробуйте начать с направления.</p>`);
    lines.push('<button type="button" class="btn" id="reset2">Сбросить всё</button>');
  }

  if (res.almost.length) {
    lines.push(`<p style="margin-top:1rem">Ниже — ${groupsWord(res.almost.length)}, где ребёнок младше или старше на год.</p>`);
  }
  lines.push('</div>');
  return lines.join('');
}

function onResultsClick(e) {
  const follow = e.target.closest('[data-follow]');
  if (follow) {
    const id = follow.dataset.follow;
    if (!followed) return offerLogin('Чтобы отслеживать цену и набор в этой группе, нужен вход.');
    const on = !followed.has(id);
    (on ? followed.add(id) : followed.delete(id), paintFollowed());
    toggleFav(id, on).catch(() => refreshFollowed());
    return;
  }
  const fix = e.target.closest('[data-fix]');
  if (fix) {
    const s = lastSuggestions[Number(fix.dataset.fix)];
    if (s) apply(s.patch);
    return;
  }
  if (e.target.id === 'more') {
    shown += PAGE;
    renderAll();
    return;
  }
  if (e.target.id === 'reset2') apply(emptyQuery());
}

function onResultsChange(e) {
  const box = e.target.closest('.cmp__box');
  if (!box) return;
  if (box.checked) {
    if (compare.size >= 3) {
      box.checked = false;
      return;
    }
    compare.add(box.value);
  } else {
    compare.delete(box.value);
  }
  renderCompareBar();
}

/* ── сравнение ───────────────────────────────────────────────────────────── */

function renderCompareBar() {
  const bar = $('cmpbar');
  bar.hidden = compare.size === 0;
  $('cmpbar-txt').textContent =
    compare.size === 3
      ? 'Выбрано три группы — больше сравнение не вмещает'
      : `Выбрано ${compare.size} из 3`;
  $('cmp-open').disabled = compare.size === 0;
}

function openCompare() {
  const groups = [...compare].map((id) => index.byId.get(id)).filter(Boolean);
  if (groups.length < 2) {
    $('cmpdlg-body').innerHTML = `<div class="nothing-here">${emptyArt('compare')}
      <p>Сравнивать пока нечего: выбрана одна группа. Отметьте ещё одну или две — покажем цену, расписание и адрес рядом.</p></div>`;
    $('cmpdlg').showModal();
    return;
  }
  const rows = [
    ['Организация', (g) => esc(g.org.name)],
    ['Адрес', (g) => `${esc(g.branch.address)}<br><span class="muted">${esc(g.branch.stationName)}, ${distance(g.branch.metroDistance)}</span>`],
    ['Возраст', (g) => `${g.ageFrom}—${g.ageTo} ${plural(g.ageTo, 'год', 'года', 'лет')}`],
    ['Расписание', (g) => g.lessons.map((l) => `${DAY_SHORT[l.day]} ${span(l.start, l.end)}`).join('<br>')],
    ['В месяц', (g) => `<span class="num">${price(g.priceMonth)}</span>`],
    ['Разово', (g) => `<span class="num">${price(g.priceSingle)}</span>`],
    ['Пробное', (g) => (g.trial.has ? (g.trial.free ? 'бесплатно' : price(g.priceSingle)) : 'нет')],
    ['В группе', (g) => `до ${g.groupSize}`],
    ['Педагог', (g) => esc(g.teacher.name)]
  ];

  $('cmpdlg-body').innerHTML = `<table class="cmptab">
    <thead><tr><th></th>${groups.map((g) => `<th scope="col"><a href="${groupUrl(g)}">${esc(g.dir.short)}: ${esc(g.title)}</a></th>`).join('')}</tr></thead>
    <tbody>${rows
      .map(([label, cell]) => `<tr><th scope="row">${label}</th>${groups.map((g) => `<td>${cell(g)}</td>`).join('')}</tr>`)
      .join('')}</tbody>
  </table>`;
  $('cmpdlg').showModal();
}

boot();
