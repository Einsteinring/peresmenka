// Генератор статических страниц.
//
// Три правила, которые тут важнее остальных:
//   1. Страница не создаётся, если под неё меньше трёх групп.
//   2. Страница не создаётся, если её состав совпадает с уже созданной хотя бы
//      на 80%: Пушкинская и Звенигородская — это 400 метров, и две одинаковые
//      страницы вредят обеим.
//   3. Всё содержимое лежит в HTML. JS нужен только форме записи.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import { buildIndex, haversine, priceStats } from '../js/model.js';
import { queryToSearch } from '../js/state.js';
import { groupRow, esc, groupUrl } from '../js/render.js';
import { coverSvg, dirIcon } from '../js/visual.js';
import {
  DAY_SHORT, ageRange, dateShort, distance, groupsWord, intake, plural, price, span, time
} from '../js/format.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://peresmenka.vercel.app';
const MIN_GROUPS = 3;
const STATION_RADIUS = 1500; // «рядом со станцией» — до 1,5 км по прямой, и так и подписано
const TWIN_OVERLAP = 0.8;
const AGES = Array.from({ length: 13 }, (_, i) => i + 4);

const geo = JSON.parse(readFileSync(join(ROOT, 'data', 'geo.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'catalog.json'), 'utf8'));
const index = buildIndex(catalog, geo);
const NOW = new Date();

// Подвал со ссылками на девять направлений: единственная перелинковка,
// которая есть на каждой странице. Собирается из каталога, а не из списка
// в разметке, иначе после смены слага ссылка молча уводит в 404.
const FOOT = `<footer class="foot">
  <div class="foot__in">
    <div>
      <p class="foot__mark">Пересменка</p>
      <p>Кружки и секции для детей в Петербурге. Демонстрационный проект: данные вымышлены,
        записаться на самом деле нельзя.</p>
    </div>
    <ul class="foot__dirs">
${index.directions.map((d) => `      <li><a href="/${d.slug}/">${esc(d.short || d.name)}</a></li>`).join('\n')}
    </ul>
  </div>
</footer>`;

// Старое дерево страниц сносим: иначе после смены слага в каталоге остаётся
// висеть каталог с прежним адресом, и sitemap расходится с тем, что лежит.
for (const dir of ['g', ...JSON.parse(readFileSync(join(ROOT, 'data', 'catalog.json'), 'utf8')).directions.map((d) => d.slug)]) {
  const path = join(ROOT, dir);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

const urls = [];
let written = 0;

function write(urlPath, html) {
  const dir = join(ROOT, urlPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  urls.push(urlPath.endsWith('/') ? urlPath : `${urlPath}/`);
  written++;
}

/* ── общая обёртка ───────────────────────────────────────────────────────── */

function layout({ title, description, canonical, crumbs, body, jsonld, dir }) {
  const crumbHtml = crumbs
    .map((c, i) => {
      const dot = c.dot ? '<span class="dot"></span>' : '';
      return i === crumbs.length - 1
        ? `<li aria-current="page">${dot}${esc(c.name)}</li>`
        : `<li><a href="${c.url}">${dot}${esc(c.name)}</a></li>`;
    })
    .join('');

  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${SITE}${c.url}`
    }))
  };

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${canonical}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%232A1E4A'/%3E%3Crect x='6' y='13' width='13' height='6' rx='3' fill='%23FF5A3C'/%3E%3Crect x='21' y='13' width='5' height='6' rx='2.5' fill='%23FFC93C'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Nunito:wght@400;700;800;900&display=swap">
<link rel="stylesheet" href="/css/app.css">
<link rel="stylesheet" href="/css/page.css">
<script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body${dir ? ` data-dir="${esc(dir)}"` : ''}>
<a class="skip" href="#main">К содержанию</a>

<header class="top">
  <div class="top__in">
    <a class="mark" href="/">Пересменка</a>
    <p class="top__demo">Демонстрационный каталог. Организации, педагоги, адреса занятий и расписание вымышлены; районы и станции метро настоящие.</p>
    <div class="top__me"><a class="top__link" href="/lk/">Кабинет</a></div>
  </div>
</header>

<nav class="crumbs" aria-label="Хлебные крошки"><ol>${crumbHtml}</ol></nav>

<main class="wrap page" id="main">
${body}
</main>

${FOOT}
</body>
</html>
`;
}

/* ── выборки ─────────────────────────────────────────────────────────────── */

const byDirection = new Map();
for (const d of index.directions) {
  byDirection.set(d.id, index.groups.filter((g) => g.direction === d.id));
}

const nearStation = new Map();
for (const st of index.stations) {
  nearStation.set(
    st.id,
    index.groups
      .map((g) => ({ g, d: haversine(g.branch.lat, g.branch.lon, st.lat, st.lon) }))
      .filter((x) => x.d <= STATION_RADIUS)
      .sort((a, b) => a.d - b.d)
  );
}

const inAge = (g, age) => g.ageFrom <= age && age <= g.ageTo;

/* ── тексты из данных ────────────────────────────────────────────────────── */

function stats(groups) {
  const p = priceStats(groups);
  const orgs = new Set(groups.map((g) => g.orgId)).size;
  const districts = [...new Set(groups.map((g) => g.district.name))];
  const stations = [...new Set(groups.map((g) => g.branch.stationName))];
  const freeTrial = groups.filter((g) => g.trial.has && g.trial.free).length;
  const soon = groups.filter((g) => intake(g.intakeStart, NOW).days <= 0).length;
  const ageFrom = Math.min(...groups.map((g) => g.ageFrom));
  const ageTo = Math.max(...groups.map((g) => g.ageTo));
  return { ...p, orgs, districts, stations, freeTrial, soon, ageFrom, ageTo, n: groups.length };
}

function introText(s, scope) {
  const bits = [];
  bits.push(`${groupsWord(s.n)} в ${s.orgs} ${plural(s.orgs, 'центре', 'центрах', 'центрах')} ${scope}.`);
  bits.push(
    s.min === s.max
      ? `Абонемент стоит ${price(s.min)} в месяц.`
      : `Месяц занятий стоит от ${price(s.min)} до ${price(s.max)}, середина — ${price(s.median)}.`
  );
  bits.push(`Берут детей ${ageRange(s.ageFrom, s.ageTo)}.`);
  if (s.soon) bits.push(`${s.soon} ${plural(s.soon, 'группа набирает', 'группы набирают', 'групп набирают')} прямо сейчас.`);
  if (s.freeTrial) bits.push(`У ${s.freeTrial} ${plural(s.freeTrial, 'группы', 'групп', 'групп')} пробное занятие бесплатное.`);
  return bits.join(' ');
}

// В описание идёт сам заголовок: две возрастные страницы могут собрать
// один и тот же список групп, и без этого их описания совпадут дословно.
function descText(s, h1) {
  return `${h1}: ${groupsWord(s.n)} в ${s.orgs} ${plural(s.orgs, 'центре', 'центрах', 'центрах')}, цены от ${price(s.min)} до ${price(s.max)} в месяц. Расписание, адреса, запись на пробное. Демонстрационный каталог.`;
}

function itemListLd(groups, name) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: groups.length,
    itemListElement: groups.slice(0, 40).map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: courseLd(g)
    }))
  };
}

function courseLd(g) {
  return {
    '@type': 'Course',
    name: `${g.dir.short}: ${g.title}`,
    description: g.about,
    url: `${SITE}${groupUrl(g)}`,
    provider: { '@type': 'Organization', name: g.org.name },
    audience: { '@type': 'PeopleAudience', suggestedMinAge: g.ageFrom, suggestedMaxAge: g.ageTo },
    offers: {
      '@type': 'Offer',
      price: g.priceMonth,
      priceCurrency: 'RUB',
      category: 'Ежемесячный абонемент',
      availability: 'https://schema.org/InStock'
    },
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'onsite',
      courseSchedule: {
        '@type': 'Schedule',
        byDay: [...new Set(g.lessons.map((l) => ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][l.day]))],
        startTime: time(g.lessons[0].start),
        endTime: time(g.lessons[0].end),
        repeatFrequency: 'P1W'
      },
      location: {
        '@type': 'Place',
        name: g.org.name,
        address: { '@type': 'PostalAddress', streetAddress: g.branch.address, addressLocality: 'Санкт-Петербург', addressCountry: 'RU' },
        geo: { '@type': 'GeoCoordinates', latitude: g.branch.lat, longitude: g.branch.lon }
      }
    }
  };
}

function linkBlock(title, links) {
  const items = links.filter(Boolean);
  if (!items.length) return '';
  return `<nav class="links" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>
    <ul>${items.map((l) => `<li><a href="${l.url}">${esc(l.name)}</a>${l.n ? ` <span class="links__n num">${l.n}</span>` : ''}</li>`).join('')}</ul>
  </nav>`;
}

/* ── каталог страниц ─────────────────────────────────────────────────────── */

// url → {groups, dir, age, station, district}
const pages = new Map();

function addPage(url, page) {
  pages.set(url, page);
}

for (const d of index.directions) {
  const all = byDirection.get(d.id);
  if (all.length >= MIN_GROUPS) addPage(`/${d.slug}/`, { dir: d, groups: all });

  for (const age of AGES) {
    const g = all.filter((x) => inAge(x, age));
    if (g.length >= MIN_GROUPS) addPage(`/${d.slug}/${age}-let/`, { dir: d, age, groups: g });
  }

  for (const district of index.districts) {
    const g = all.filter((x) => x.branch.districtId === district.id);
    if (g.length >= MIN_GROUPS) addPage(`/${d.slug}/rayon-${district.slug}/`, { dir: d, district, groups: g });
  }
}

// Станционные страницы — с отсевом близнецов внутри одной пары
// (направление, возраст).
let twinsDropped = 0;
for (const d of index.directions) {
  for (const age of [null, ...AGES]) {
    const candidates = [];
    for (const st of index.stations) {
      const list = nearStation
        .get(st.id)
        .filter((x) => x.g.direction === d.id && (age === null || inAge(x.g, age)));
      if (list.length >= MIN_GROUPS) candidates.push({ st, list });
    }
    candidates.sort((a, b) => b.list.length - a.list.length);

    const kept = [];
    for (const c of candidates) {
      const ids = new Set(c.list.map((x) => x.g.id));
      const twin = kept.some((k) => {
        const other = new Set(k.list.map((x) => x.g.id));
        let inter = 0;
        for (const id of ids) if (other.has(id)) inter++;
        return inter / (ids.size + other.size - inter) >= TWIN_OVERLAP;
      });
      if (twin) {
        twinsDropped++;
        continue;
      }
      kept.push(c);
      const url = age === null ? `/${d.slug}/${c.st.slug}/` : `/${d.slug}/${age}-let/${c.st.slug}/`;
      addPage(url, { dir: d, age, station: c.st, groups: c.list.map((x) => x.g), dist: c.list });
    }
  }
}

/* ── отрисовка страниц-списков ───────────────────────────────────────────── */

function pageTitleAndScope(p) {
  const dir = p.dir.short;
  if (p.station && p.age) return [`${dir} для детей ${p.age} лет у метро ${p.station.name}`, `у метро ${p.station.name}`];
  if (p.station) return [`${dir} для детей у метро ${p.station.name}`, `у метро ${p.station.name}`];
  if (p.district && p.age) return [`${dir} для детей ${p.age} лет в ${p.district.name.replace(/ий$/, 'ом')} районе`, `в ${p.district.name.replace(/ий$/, 'ом')} районе`];
  if (p.district) return [`${dir} для детей в ${p.district.name.replace(/ий$/, 'ом')} районе`, `в ${p.district.name.replace(/ий$/, 'ом')} районе`];
  if (p.age) return [`${dir} для детей ${p.age} лет в Петербурге`, 'в Петербурге'];
  return [`${dir} для детей в Петербурге`, 'в Петербурге'];
}

function crumbsFor(url, p) {
  const out = [{ name: 'Все кружки', url: '/' }, { name: p.dir.short, url: `/${p.dir.slug}/`, dot: true }];
  if (p.age && pages.has(`/${p.dir.slug}/${p.age}-let/`) && url !== `/${p.dir.slug}/${p.age}-let/`) {
    out.push({ name: `${p.age} лет`, url: `/${p.dir.slug}/${p.age}-let/` });
  }
  const [h1] = pageTitleAndScope(p);
  out.push({ name: h1, url });
  return out;
}

function searchLink(p) {
  const patch = { directions: [p.dir.id] };
  if (p.age) patch.children = [{ age: p.age, name: '' }];
  if (p.station) {
    patch.geoMode = 'near';
    patch.point = { lat: p.station.lat, lon: p.station.lon, label: `метро ${p.station.name}` };
    patch.radius = STATION_RADIUS;
    patch.sort = 'distance';
  }
  if (p.district) {
    patch.geoMode = 'district';
    patch.districts = [p.district.id];
  }
  return `/${queryToSearch({
    directions: [], children: [], windows: [], strict: false, geoMode: 'off',
    districts: [], stations: [], point: null, radius: 2000, sort: 'match', ...patch
  })}`;
}

function renderListPage(url, p) {
  const [h1, scope] = pageTitleAndScope(p);
  const s = stats(p.groups);
  const distMap = new Map((p.dist || []).map((x) => [x.g.id, x.d]));

  const sorted = p.dist
    ? p.groups.slice().sort((a, b) => distMap.get(a.id) - distMap.get(b.id))
    : p.groups.slice().sort((a, b) => a.priceMonth - b.priceMonth);

  const title = `${h1} — ${groupsWord(s.n)}, от ${price(s.min)}`;

  /* перелинковка */
  const ageLinks = [];
  if (p.age) {
    for (const delta of [-2, -1, 1, 2]) {
      const age = p.age + delta;
      const u = p.station
        ? `/${p.dir.slug}/${age}-let/${p.station.slug}/`
        : p.district
          ? null
          : `/${p.dir.slug}/${age}-let/`;
      if (u && pages.has(u)) ageLinks.push({ name: `${p.dir.short}, ${age} лет`, url: u, n: pages.get(u).groups.length });
    }
  } else {
    for (const age of [6, 8, 10, 12]) {
      const u = p.station ? `/${p.dir.slug}/${age}-let/${p.station.slug}/` : `/${p.dir.slug}/${age}-let/`;
      if (pages.has(u)) ageLinks.push({ name: `${p.dir.short}, ${age} лет`, url: u, n: pages.get(u).groups.length });
    }
  }

  // У соседней станции страница этого возраста могла не создаться — либо
  // групп меньше трёх, либо она оказалась близнецом. Тогда ведём на страницу
  // направления у той же станции, а не в никуда.
  const nearLinks = [];
  if (p.station) {
    for (const nb of index.stationNeighbours.get(p.station.id) || []) {
      const st = index.stationById.get(nb);
      const exact = p.age ? `/${p.dir.slug}/${p.age}-let/${st.slug}/` : null;
      const wide = `/${p.dir.slug}/${st.slug}/`;
      const u = exact && pages.has(exact) ? exact : pages.has(wide) ? wide : null;
      if (!u) continue;
      nearLinks.push({
        name: u === exact ? `${p.dir.short} ${p.age} лет у метро ${st.name}` : `${p.dir.short} у метро ${st.name}`,
        url: u,
        n: pages.get(u).groups.length
      });
    }
  }

  const otherDirs = [];
  for (const d of index.directions) {
    if (d.id === p.dir.id) continue;
    const u = p.station
      ? `/${d.slug}/${p.station.slug}/`
      : p.district
        ? `/${d.slug}/rayon-${p.district.slug}/`
        : p.age
          ? `/${d.slug}/${p.age}-let/`
          : `/${d.slug}/`;
    if (pages.has(u)) otherDirs.push({ name: d.short, url: u, n: pages.get(u).groups.length });
  }

  // Страницы направлений есть всегда, поэтому этот блок не бывает пустым:
  // с любой страницы можно уйти вглубь каталога, а не в тупик.
  const allDirs = index.directions
    .filter((d) => pages.has(`/${d.slug}/`))
    .map((d) => ({ name: `${d.short} по всему городу`, url: `/${d.slug}/`, n: pages.get(`/${d.slug}/`).groups.length }));

  const body = `
<p class="page-dir">${dirIcon(p.dir.id, 20)}<span>${esc(p.dir.name)}</span></p>
<h1>${esc(h1)}</h1>
<div class="page-rule"></div>
<p class="intro">${esc(introText(s, scope))}</p>
${p.station ? `<p class="intro intro--note">В список попадают занятия не дальше 1,5 км от вестибюля по прямой. У каждой группы указано её настоящее расстояние.</p>` : ''}

<p class="opensearch"><a class="btn" href="${searchLink(p)}">Открыть в поиске с этими фильтрами</a>
<span class="opensearch__hint">Там можно задать окно в расписании и посмотреть, какие занятия в него попадают.</span></p>

<h2 class="listhead">${groupsWord(s.n)}${p.dist ? ', ближайшие сверху' : ', от дешёвых к дорогим'}</h2>
<ol class="rows">${sorted.map((g) => groupRow(g, { distance: distMap.get(g.id), distanceTo: p.station ? p.station.name : null })).join('')}</ol>

<div class="linkgrid">
  ${linkBlock('Другой возраст', ageLinks)}
  ${linkBlock(p.station ? 'Соседние станции' : 'Рядом', nearLinks.length ? nearLinks : otherDirs.slice(0, 6))}
  ${linkBlock(p.station || p.district ? 'Другое здесь же' : 'Другие направления', (otherDirs.length && nearLinks.length ? otherDirs : allDirs).slice(0, 9))}
</div>
`;

  return layout({
    title,
    description: descText(s, h1),
    canonical: url,
    crumbs: crumbsFor(url, p),
    body,
    dir: p.dir.id,
    jsonld: itemListLd(sorted, h1)
  });
}

for (const [url, p] of pages) write(url, renderListPage(url, p));

/* ── карточки групп ──────────────────────────────────────────────────────── */

function mapBlock(branch) {
  const dLat = 0.0035;
  const dLon = 0.008;
  const bbox = [branch.lon - dLon, branch.lat - dLat, branch.lon + dLon, branch.lat + dLat]
    .map((v) => v.toFixed(5))
    .join(',');
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${branch.lat},${branch.lon}`;
  const full = `https://www.openstreetmap.org/?mlat=${branch.lat}&mlon=${branch.lon}#map=16/${branch.lat}/${branch.lon}`;
  return `<div class="map">
    <iframe src="${embed}" title="Карта: ${esc(branch.address)}" loading="lazy" referrerpolicy="no-referrer"></iframe>
    <p class="map__note">${esc(branch.stationName)} — ${distance(branch.metroDistance)} по прямой.
      <a href="${full}" rel="noopener nofollow" target="_blank">Открыть карту крупнее</a></p>
  </div>`;
}

function renderGroupPage(g) {
  const url = groupUrl(g);
  const start = intake(g.intakeStart, NOW);
  const sameBranch = index.groups.filter((x) => x.branchId === g.branchId && x.id !== g.id);
  const sameDirNear = nearStation
    .get(g.branch.stationId)
    .filter((x) => x.g.direction === g.direction && x.g.id !== g.id && x.g.branchId !== g.branchId)
    .slice(0, 6);

  const crumbs = [{ name: 'Все кружки', url: '/' }, { name: g.dir.short, url: `/${g.dir.slug}/`, dot: true }];
  const stationPage = `/${g.dir.slug}/${index.stationById.get(g.branch.stationId).slug}/`;
  if (pages.has(stationPage)) {
    crumbs.push({ name: `${g.dir.short} у метро ${g.branch.stationName}`, url: stationPage });
  }
  crumbs.push({ name: `${g.dir.short}: ${g.title}`, url });

  const body = `
<div class="hero-cover">${coverSvg(g, 960, 120)}${dirIcon(g.direction, 22)}</div>
<h1>${esc(g.dir.short)}: ${esc(g.title)}</h1>
<p class="intro">${esc(g.org.name)} — ${esc(g.branch.address)}. Группа ${ageRange(g.ageFrom, g.ageTo)}, ${g.level === 'start' ? 'занимаются с нуля' : 'для продолжающих'}, до ${g.groupSize} ${plural(g.groupSize, 'человека', 'человек', 'человек')}.</p>

<div class="cols">
  <div class="cols__main">
    <section class="block">
      <h2>Расписание</h2>
      <ul class="sched">${g.lessons
        .map((l) => `<li><span class="sched__day">${DAY_SHORT[l.day]}</span><span class="sched__time num">${span(l.start, l.end)}</span><span class="sched__len">${l.end - l.start} мин</span></li>`)
        .join('')}</ul>
      <p class="block__note">${start.text === 'набор идёт' ? 'Набор идёт, можно присоединиться к текущей группе.' : `Набор открывается ${dateShort(g.intakeStart)}.`}</p>
    </section>

    <section class="block">
      <h2>Чем занимаются</h2>
      <p>${esc(g.about)}</p>
      ${g.subtype ? `<p>Направление внутри курса: ${esc(g.subtype)}.</p>` : ''}
      <h3>Что принести</h3>
      <ul class="brings">${g.brings.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    </section>

    <section class="block">
      <h2>Педагог</h2>
      <p><strong>${esc(g.teacher.name)}</strong> — ${esc(g.teacher.note)}.</p>
    </section>

    <section class="block" id="signup">
      <h2>Записаться на пробное</h2>
      <p class="block__note">${g.trial.has ? (g.trial.free ? 'Первое занятие бесплатное.' : `Пробное занятие — ${price(g.priceSingle)}.`) : 'Пробного занятия в этой группе нет, но можно договориться о визите.'}</p>
      <form class="lead" id="lead" novalidate>
        <input type="hidden" name="groupId" value="${g.id}">
        <label class="field"><span>Ваше имя</span><input name="parent" required autocomplete="name"></label>
        <label class="field"><span>Телефон</span><input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00"></label>
        <label class="field"><span>Имя ребёнка</span><input name="child" required></label>
        <label class="field"><span>Возраст ребёнка</span><input name="childAge" type="number" min="2" max="18" required class="num"></label>
        <label class="field"><span>Когда удобно позвонить</span>
          <select name="callTime">
            <option>в любое время</option>
            <option>утром, 9:00—12:00</option>
            <option>днём, 12:00—17:00</option>
            <option>вечером, 17:00—21:00</option>
          </select>
        </label>
        <button class="btn" type="submit">Отправить заявку</button>
        <p class="lead__msg" id="lead-msg" role="status"></p>
      </form>
    </section>
  </div>

  <aside class="cols__side">
    <p class="facts__follow"><button type="button" class="follow" data-follow="${g.id}" aria-pressed="false">Отслеживать</button></p>
    <dl class="facts">
      <div><dt>В месяц</dt><dd class="num">${price(g.priceMonth)}</dd></div>
      <div><dt>Разовое</dt><dd class="num">${price(g.priceSingle)}</dd></div>
      <div><dt>Возраст</dt><dd>${ageRange(g.ageFrom, g.ageTo)}</dd></div>
      <div><dt>В группе</dt><dd>до ${g.groupSize}</dd></div>
      <div><dt>Набор</dt><dd>${esc(start.text)}</dd></div>
      <div><dt>Район</dt><dd>${esc(g.district.name)}</dd></div>
    </dl>
    ${mapBlock(g.branch)}
  </aside>
</div>

${sameBranch.length ? `<section class="block">
  <h2>Ещё в этом филиале</h2>
  <ol class="rows">${sameBranch.map((x) => groupRow(x, { dot: true })).join('')}</ol>
</section>` : ''}

${sameDirNear.length ? `<section class="block">
  <h2>${esc(g.dir.short)} рядом, у других центров</h2>
  <ol class="rows">${sameDirNear.map((x) => groupRow(x.g, { distance: haversine(g.branch.lat, g.branch.lon, x.g.branch.lat, x.g.branch.lon) })).join('')}</ol>
</section>` : ''}

<script type="module" src="/js/lead.js"></script>
`;

  return layout({
    title: `${g.dir.short}: ${g.title} — ${g.ageFrom}—${g.ageTo} лет, ${g.branch.stationName}, ${price(g.priceMonth)} в месяц`,
    description: `${g.org.name}, ${g.branch.address}. ${g.lessons.map((l) => `${DAY_SHORT[l.day]} ${span(l.start, l.end)}`).join(', ')}. ${price(g.priceMonth)} в месяц, ${g.trial.has && g.trial.free ? 'пробное бесплатно' : 'пробное платное'}. Демонстрационный каталог.`,
    canonical: url,
    crumbs,
    body,
    dir: g.direction,
    jsonld: { '@context': 'https://schema.org', ...courseLd(g) }
  });
}

for (const g of index.groups) write(groupUrl(g), renderGroupPage(g));

/* ── sitemap и robots ────────────────────────────────────────────────────── */

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${['/', ...urls].map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`.replace('www.sitemap.org', 'www.sitemaps.org');

writeFileSync(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
writeFileSync(
  join(ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
  'utf8'
);

/* ── отчёт ───────────────────────────────────────────────────────────────── */

const kinds = { направление: 0, возраст: 0, метро: 0, 'возраст+метро': 0, район: 0 };
for (const [url, p] of pages) {
  if (p.station && p.age) kinds['возраст+метро']++;
  else if (p.station) kinds.метро++;
  else if (p.district) kinds.район++;
  else if (p.age) kinds.возраст++;
  else kinds.направление++;
}

console.log(`Создано страниц: ${written}`);
for (const [k, v] of Object.entries(kinds)) console.log(`  ${k.padEnd(16)} ${String(v).padStart(4)}`);
console.log(`  ${'карточки групп'.padEnd(16)} ${String(index.groups.length).padStart(4)}`);
console.log(`Отброшено: ${twinsDropped} страниц-близнецов (состав совпадал минимум на ${TWIN_OVERLAP * 100}%)`);
console.log(`Порог: ${MIN_GROUPS} группы. Радиус станции: ${STATION_RADIUS} м.`);
console.log(`sitemap.xml: ${urls.length + 1} адрес`);
