// Графика: пиктограммы направлений, обложки карточек, рисунки пустых
// состояний. Только строки, без DOM — этот модуль зовут и браузер,
// и генератор статических страниц.
//
// Цветов здесь нет намеренно. Палитра девяти направлений живёт в одном
// месте — в css/app.css под [data-dir="…"], а разметка берёт её через
// var(--d-chip) и var(--d-wash). Так цвет невозможно рассинхронизировать
// между поиском и статикой.
//
// Ограничение всего набора пиктограмм: сетка 24×24, обводка 2,
// только горизонтали, вертикали, диагонали под 45° и окружности.
// Дуга на девять знаков ровно одна — у танцев, где она значит движение.
// Пиктограмма всегда лежит в насыщенном кружке своего направления,
// поэтому рисуется чернилами через currentColor, а не цветом.

/* ── пиктограммы ─────────────────────────────────────────────────────────── */

const ICONS = {
  // чип: корпус, ядро, выводы по бокам
  robototehnika:
    '<rect x="5" y="5" width="14" height="14"/>' +
    '<rect x="9.75" y="9.75" width="4.5" height="4.5"/>' +
    '<path d="M2 9.5h3M2 14.5h3M19 9.5h3M19 14.5h3"/>',

  // разделительный трос дорожки: прямая с поплавками и соседняя дорожка
  plavanie:
    '<path d="M3 9h18M6 15.5h12"/>' +
    '<circle cx="7.5" cy="9" r="1.7"/><circle cx="12" cy="9" r="1.7"/><circle cx="16.5" cy="9" r="1.7"/>',

  // две ноты под общей перекладиной
  muzyka:
    '<circle cx="7.5" cy="16" r="2.6"/><circle cx="16.5" cy="16" r="2.6"/>' +
    '<path d="M10.1 16V5M19.1 16V5M10.1 5h9"/>',

  // реплика: рамка, хвост под 45°, две строки
  yazyki:
    '<rect x="3" y="5" width="18" height="12"/>' +
    '<path d="M8 17v4l4-4M6.5 9.5h11M6.5 13h7"/>',

  // ладья: зубчатая корона, корпус, основание
  shahmaty:
    '<path d="M6 9V6h3.5v2h5V6H18v3"/>' +
    '<path d="M6 9h12M7.5 9v9M16.5 9v9"/>' +
    '<rect x="5" y="18" width="14" height="2.5"/>',

  // карандаш: собран по осям и повёрнут на 45°, поэтому все рёбра ровные
  risovanie:
    '<g transform="rotate(-45 12 12)">' +
    '<path d="M6 9.8h10v4.4H6zM12.5 9.8v4.4"/>' +
    '<path d="M16 9.8l3.6 2.2-3.6 2.2z"/>' +
    '</g>',

  // пояс с узлом и двумя концами
  edinoborstva:
    '<rect x="3" y="10" width="18" height="4"/>' +
    '<rect x="9.75" y="8.5" width="4.5" height="7"/>' +
    '<path d="M11 15.5L8 18.5M13 15.5l3 3"/>',

  // шаг: опора, дуга следа, следующая опора. единственная дуга набора
  tancy:
    '<circle cx="6.5" cy="17.5" r="2.4"/><circle cx="17.5" cy="7" r="1.7"/>' +
    '<path d="M8.6 16.2A9 9 0 0 1 16.4 8.4" fill="none"/>',

  // прожектор: лампа, конус под 45°, световое пятно
  teatr:
    '<circle cx="12" cy="4.6" r="2.2"/>' +
    '<path d="M12 7l-7 7M12 7l7 7M5 14h14"/>'
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
