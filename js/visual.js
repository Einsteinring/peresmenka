// Графика: пиктограммы направлений, обложки карточек, рисунки пустых
// состояний. Только строки, без DOM — этот модуль зовут и браузер,
// и генератор статических страниц.
//
// Цветов здесь нет намеренно. Палитра девяти направлений живёт в одном
// месте — в css/app.css под [data-dir="…"], а разметка берёт её через
// var(--d-chip) и var(--d-wash). Так цвет невозможно рассинхронизировать
// между поиском и статикой.
//
// Пиктограммы взяты из эталона design/reference.html: сетка 24×24,
// обводка 2, скруглённые концы. Каждая лежит в насыщенном квадрате
// своего направления, поэтому рисуется чернилами через currentColor.

/* ── пиктограммы ─────────────────────────────────────────────────────────── */

const ICONS = {
  // робот: корпус, антенна, глаза, уши
  robototehnika:
    '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4"/>' +
    '<circle cx="9.5" cy="13" r="1"/><circle cx="14.5" cy="13" r="1"/><path d="M3 12v3M21 12v3"/>',

  // пловец: голова над двумя волнами
  plavanie:
    '<circle cx="16" cy="5" r="2"/><path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>' +
    '<path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M6 11l5-4 3 3"/>',

  // две ноты под общей перекладиной
  muzyka:
    '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',

  // реплика с хвостом и двумя строками
  yazyki:
    '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',

  // ладья
  shahmaty:
    '<path d="M6 4h2v2h2V4h4v2h2V4h2v4l-2 2v7h2v3H6v-3h2v-7L6 8z"/>',

  // кисть и мазок
  risovanie:
    '<path d="M18 3l3 3-9 9-3-3z"/><path d="M9 12c-3 0-5 2-5 5 0 1-1 2-2 2 2 2 7 2 8-1 1-2 1-4-1-6z"/>',

  // пояс с узлом и двумя концами
  edinoborstva:
    '<path d="M3 9h18v4H3z"/><rect x="10" y="8" width="4" height="6" rx="1"/><path d="M11 14l-3 7M13 14l3 7"/>',

  // танцор в движении
  tancy:
    '<circle cx="13" cy="4" r="2"/><path d="M13 6l-2 7 4 3-1 5"/><path d="M11 13l-4 4"/><path d="M7 8l6-1 5 3"/>',

  // театральные маски
  teatr:
    '<path d="M3 4h10v6a5 5 0 0 1-10 0z"/><path d="M6 8h.01M10 8h.01"/><path d="M6 11c1 1 3 1 4 0"/>' +
    '<path d="M15 9h6v6a5 5 0 0 1-8.5 3.5"/><path d="M16 12h.01M20 12h.01"/>'
};

export const DIRECTION_IDS = Object.keys(ICONS);

export function dirIcon(dirId, size = 24, extraClass = '') {
  const body = ICONS[dirId];
  if (!body) return '';
  return `<svg class="ic${extraClass ? ` ${extraClass}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* ── обложки ─────────────────────────────────────────────────────────────── */

// Обложка выводится из id группы, а не из случайности: у 310 групп 310 разных
// обложек, и при пересборке каталога они не перетасовываются.
//
// Рисунок — несколько мягких пятен, наползающих друг на друга и обрезанных
// краем. Пятно строится по кольцу точек со смещёнными радиусами и замыкается
// квадратичными кривыми через середины рёбер: получается замкнутая клякса
// без углов и без единой прямой.

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// xorshift32: тот же id — та же последовательность, на любом движке.
function seeded(seed) {
  let x = seed || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

function blobPath(cx, cy, r, rnd, points = 7) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (0.68 + rnd() * 0.56);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const f = (n) => n.toFixed(1);

  let [mx, my] = mid(pts[points - 1], pts[0]);
  let d = `M${f(mx)} ${f(my)}`;
  for (let i = 0; i < points; i++) {
    const cur = pts[i];
    [mx, my] = mid(cur, pts[(i + 1) % points]);
    d += `Q${f(cur[0])} ${f(cur[1])} ${f(mx)} ${f(my)}`;
  }
  return d + 'Z';
}

// Пятна раскладываются вдоль длинной стороны, а их число выводится из
// пропорции: одна и та же обложка должна читаться и на полосе карточки
// 88×240, и на ленте страницы группы 960×120.
export function coverSvg(group, width = 88, height = 240) {
  const rnd = seeded(hash32(`${group.id}:${group.slug || ''}`));
  const vertical = height >= width;
  const long = vertical ? height : width;
  const short = vertical ? width : height;
  const count = Math.min(7, Math.max(3, Math.round(long / short / 1.2)));

  const tones = [
    ['var(--surface)', 0.55],
    ['var(--d-chip)', 0.38],
    ['var(--d-chip)', 0.2],
    ['var(--surface)', 0.32]
  ];

  const blobs = [];
  for (let i = 0; i < count; i++) {
    const along = ((i + 0.5) / count + (rnd() - 0.5) * 0.24) * long;
    const across = (0.22 + rnd() * 0.56) * short;
    const r = short * (0.42 + rnd() * 0.44);
    const [fill, opacity] = tones[i % tones.length];
    const d = blobPath(vertical ? across : along, vertical ? along : across, r, rnd);
    blobs.push(`<path d="${d}" fill="${fill}" opacity="${opacity}"/>`);
  }

  return `<svg class="cover__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
    `<rect width="${width}" height="${height}" fill="var(--d-wash)"/>` +
    blobs.join('') +
    '</svg>';
}

// Обложка карточки в выдаче — три композиции эталона: круг в углу, повёрнутый
// квадрат, волна по низу. Какая из трёх и куда сдвинуты фигуры — из id
// группы, поэтому соседние карточки не повторяют друг друга, а при
// пересборке ничего не тасуется. Холст 400×150, срез по ширине карточки.
export function cardCover(group) {
  const rnd = seeded(hash32(`card:${group.id}`));
  const dx = Math.round((rnd() - 0.5) * 60);
  const turn = Math.round(8 + rnd() * 16);
  const kind = Math.floor(rnd() * 3);
  const chip = 'fill="var(--d-chip)"';
  const white = 'fill="var(--surface)"';
  const shapes = [
    `<circle cx="${330 + dx}" cy="30" r="60" ${chip} opacity=".5"/><circle cx="${40 + dx}" cy="150" r="50" ${white} opacity=".6"/>` +
      `<path d="M${210 + dx} 124l10-20 10 20-10-5z" fill="var(--ink)" opacity=".15"/>`,
    `<rect x="${280 + dx}" y="-20" width="130" height="130" rx="30" ${chip} opacity=".5" transform="rotate(${turn} ${345 + dx} 45)"/>` +
      `<circle cx="${200 + dx}" cy="160" r="46" ${white} opacity=".6"/>`,
    `<path d="M0 110c30-18 60-18 90 0s60 18 90 0 60-18 90 0 60 18 90 0 60-18 90 0v60H0z" ${chip} opacity=".55" transform="translate(${dx / 2} 0)"/>` +
      `<circle cx="${340 + dx / 2}" cy="36" r="22" ${white} opacity=".7"/>`
  ];
  return `<svg class="cover__svg" viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${shapes[kind]}</svg>`;
}

// Наклон значка на обложке — тоже из id: в эталоне у трёх карточек −6°, 5°, −4°.
export function cardTilt(group) {
  const rnd = seeded(hash32(`tilt:${group.id}`));
  const deg = 3 + Math.round(rnd() * 3);
  return rnd() < 0.5 ? -deg : deg;
}

/* ── рисунки пустых состояний ────────────────────────────────────────────── */

// Та же обводка 1,75, что и у пиктограмм: пустой экран — часть того же набора,
// а не картинка из другого места.

const ART = {
  // окно и занятие разминулись на шкале дня
  nothing:
    '<path d="M6 52h108"/>' +
    '<rect x="14" y="26" width="42" height="17" fill="var(--window-soft)" stroke="var(--window-line)"/>' +
    '<rect x="72" y="26" width="34" height="17"/>' +
    '<path d="M58 34.5h12" stroke-dasharray="3 3"/>' +
    '<path d="M14 52v5M56 52v5M72 52v5M106 52v5"/>',

  // две пустые колонки сравнения
  compare:
    '<rect x="14" y="12" width="36" height="48"/>' +
    '<rect x="70" y="12" width="36" height="48"/>' +
    '<path d="M22 24h20M22 32h14M22 40h18M78 24h20M78 32h14M78 40h18" opacity=".5"/>' +
    '<path d="M60 20v32" stroke-dasharray="3 4"/>',

  // линейка возрастов с пустым бегунком
  age:
    '<path d="M12 42h96"/>' +
    '<path d="M12 42v-7M28 42v-4M44 42v-7M60 42v-4M76 42v-7M92 42v-4M108 42v-7"/>' +
    '<circle cx="60" cy="42" r="7" fill="var(--surface)"/>' +
    '<path d="M60 56v4" stroke-dasharray="2 3"/>'
};

export function emptyArt(kind) {
  const body = ART[kind];
  if (!body) return '';
  return `<svg class="art" viewBox="0 0 120 68" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
