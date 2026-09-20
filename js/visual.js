// Графика: пиктограммы направлений, обложки карточек, рисунки пустых
// состояний. Только строки, без DOM — этот модуль зовут и браузер,
// и генератор статических страниц.
//
// Цветов здесь нет намеренно. Палитра девяти направлений живёт в одном
// месте — в css/app.css под [data-dir="…"], а разметка берёт её через
// var(--d-ink) и var(--d-wash). Так цвет невозможно рассинхронизировать
// между поиском и статикой.
//
// Ограничение всего набора пиктограмм: сетка 24×24, обводка 1,75,
// только горизонтали, вертикали, диагонали под 45° и окружности.
// Дуга на девять знаков ровно одна — у танцев, где она значит движение.

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
  return `<svg class="ic${extraClass ? ` ${extraClass}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* ── обложки ─────────────────────────────────────────────────────────────── */

// Случайная маска даёт шум, поэтому клетка закрашивается не броском монеты,
// а арифметическим правилом: (a·c + b·r) mod m < t. Такое поле всегда
// структурно — выходят диагонали, шахматка, разреженная решётка, муар,
// но никогда каша.

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Фигура своего направления попадается чаще: обложка перекликается
// с пиктограммой, но не повторяет её.
const FAVOURITE = {
  robototehnika: 'square',
  plavanie: 'circle',
  muzyka: 'circle',
  yazyki: 'bar',
  shahmaty: 'square',
  risovanie: 'triangle',
  edinoborstva: 'bar',
  tancy: 'ring',
  teatr: 'triangle'
};

const SHAPES = ['circle', 'square', 'bar', 'triangle', 'ring'];

// Сетка задаётся размером клетки, а не числом колонок: одна и та же обложка
// должна одинаково читаться и на узкой полосе карточки 88×240, и на широкой
// ленте страницы группы 960×120. Раньше числа рядов и колонок брались из
// хэша напрямую — и на ленте 8:1 клетки растягивались в пустые прямоугольники.
function coverPlan(group, width, height) {
  const h = hash32(`${group.id}:${group.slug || ''}`);
  const pick = (shift, mod) => (h >>> shift) % mod;

  const inner = { w: width * 0.72, h: height * 0.84 };
  const cell = 17 + pick(0, 4) * 6;
  let cols = Math.max(3, Math.round(inner.w / cell));
  let rows = Math.max(2, Math.round(inner.h / cell));
  while (rows * cols > 240) { cols = Math.max(3, cols - 1); rows = Math.max(2, rows - 1); }

  const shape = pick(6, 3) === 0 ? SHAPES[pick(8, SHAPES.length)] : FAVOURITE[group.direction] || 'circle';
  const a = 1 + pick(11, 4);
  const b = 1 + pick(14, 4);
  const m = 3 + pick(17, 5);
  let t = 1 + (h >>> 21) % Math.max(1, m - 1);
  // Совсем редкая решётка читается как пустое место, поэтому поднимаем
  // порог, пока фигур не наберётся хотя бы шесть.
  while (t < m - 1 && (rows * cols * t) / m < 6) t++;
  const tones = pick(24, 2) === 0 ? [0.16, 0.32] : [0.14, 0.28, 0.5];
  const focus = (h >>> 26) % (rows * cols);
  return { rows, cols, shape, a, b, m, t, tones, focus };
}

function shapeMarkup(shape, cx, cy, unit, opacity) {
  const o = opacity.toFixed(2);
  switch (shape) {
    case 'square': {
      const s = unit * 1.05;
      return `<rect x="${(cx - s / 2).toFixed(1)}" y="${(cy - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" opacity="${o}"/>`;
    }
    case 'bar': {
      const w = unit * 1.7;
      const hgt = unit * 0.5;
      return `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - hgt / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${hgt.toFixed(1)}" opacity="${o}"/>`;
    }
    case 'triangle': {
      const s = unit * 1.15;
      return `<path d="M${cx.toFixed(1)} ${(cy - s).toFixed(1)}L${(cx + s).toFixed(1)} ${(cy + s * 0.7).toFixed(1)}H${(cx - s).toFixed(1)}Z" opacity="${o}"/>`;
    }
    case 'ring':
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(unit * 0.78).toFixed(1)}" fill="none" stroke="var(--d-ink)" stroke-width="${(unit * 0.34).toFixed(2)}" opacity="${o}"/>`;
    default:
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(unit * 0.62).toFixed(1)}" opacity="${o}"/>`;
  }
}

export function coverSvg(group, width = 88, height = 240) {
  const p = coverPlan(group, width, height);
  const padX = width * 0.14;
  const padY = height * 0.08;
  const stepX = (width - padX * 2) / p.cols;
  const stepY = (height - padY * 2) / p.rows;
  const unit = Math.min(stepX, stepY) * 0.42;

  const marks = [];
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const i = r * p.cols + c;
      const on = (p.a * c + p.b * r) % p.m < p.t;
      if (!on && i !== p.focus) continue;
      const cx = padX + stepX * (c + 0.5);
      const cy = padY + stepY * (r + 0.5);
      const opacity = i === p.focus ? 0.9 : p.tones[(c + r) % p.tones.length];
      marks.push(shapeMarkup(p.shape, cx, cy, unit, opacity));
    }
  }

  return `<svg class="cover__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
    `<rect width="${width}" height="${height}" fill="var(--d-wash)"/>` +
    `<g fill="var(--d-ink)">${marks.join('')}</g>` +
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
