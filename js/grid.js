// Недельная сетка и её текстовый двойник.
//
// Оба редактора правят одно и то же — маску 7×30. Сетка нужна мыши, список —
// пальцу, клавиатуре и скринридеру. Протяжка пальцем по ячейке шириной 14 px
// не работает, поэтому на узком экране список не запасной вариант, а основной.

import { GRID, maskToWindows, windowsToMask } from './model.js';
import { DAY_FULL, DAY_SHORT, time } from './format.js';

const COLS = GRID.cols;
const colTime = (c) => GRID.dayStart + c * GRID.step;

export function createGrid(root, onChange) {
  let mask = new Uint8Array(7 * COLS);
  let cursor = { row: 0, col: 18 }; // четверг 16:00 — самое частое место старта
  let drag = null;

  const cells = [];

  /* разметка */

  const frag = document.createDocumentFragment();

  const corner = document.createElement('div');
  corner.className = 'grid__corner';
  corner.setAttribute('role', 'presentation');
  frag.append(corner);

  for (let h = GRID.dayStart / 60; h < GRID.dayEnd / 60; h += 2) {
    const col = 2 + ((h * 60 - GRID.dayStart) / GRID.step);
    const label = document.createElement('div');
    label.className = 'grid__hour';
    label.style.gridColumn = `${col} / span ${Math.min(4, 31 - col + 1)}`;
    label.textContent = String(h);
    label.setAttribute('role', 'columnheader');
    frag.append(label);
  }

  for (let r = 0; r < 7; r++) {
    const day = r + 1;
    const rowEl = document.createElement('div');
    rowEl.className = 'grid__day';
    rowEl.style.gridRow = String(r + 2);
    rowEl.setAttribute('role', 'rowheader');
    rowEl.textContent = DAY_SHORT[day];
    frag.append(rowEl);

    cells[r] = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.style.gridRow = String(r + 2);
      cell.style.gridColumn = String(c + 2);
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      if (colTime(c) % 120 === 0) cell.dataset.hour = '1';
      cell.tabIndex = -1;
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${DAY_FULL[day]}, ${time(colTime(c))}`);
      cells[r][c] = cell;
      frag.append(cell);
    }
  }

  root.append(frag);
  root.setAttribute('role', 'grid');
  root.setAttribute('aria-label', 'Недельная сетка: закрасьте окна, когда вам удобно возить ребёнка');

  /* отрисовка */

  function paintDom() {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < COLS; c++) {
        const on = mask[r * COLS + c] === 1;
        const cell = cells[r][c];
        if ((cell.dataset.on === '1') !== on) cell.dataset.on = on ? '1' : '0';
        cell.setAttribute('aria-selected', on ? 'true' : 'false');
        cell.dataset.cursor = r === cursor.row && c === cursor.col ? '1' : '0';
        cell.tabIndex = r === cursor.row && c === cursor.col ? 0 : -1;
      }
    }
  }

  const emit = () => onChange(maskToWindows(mask));

  /* протяжка прямоугольником: за один жест можно закрыть пн—пт 16:00—19:00 */

  function applyRect(base, a, b, value) {
    const next = Uint8Array.from(base);
    const r0 = Math.min(a.row, b.row);
    const r1 = Math.max(a.row, b.row);
    const c0 = Math.min(a.col, b.col);
    const c1 = Math.max(a.col, b.col);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) next[r * COLS + c] = value;
    }
    return next;
  }

  function cellFrom(target) {
    if (!target || !target.dataset || target.dataset.r === undefined) return null;
    return { row: Number(target.dataset.r), col: Number(target.dataset.c) };
  }

  root.addEventListener('pointerdown', (e) => {
    const at = cellFrom(e.target);
    if (!at) return;
    e.preventDefault();
    const value = mask[at.row * COLS + at.col] === 1 ? 0 : 1;
    drag = { anchor: at, base: Uint8Array.from(mask), value };
    cursor = at;
    mask = applyRect(drag.base, at, at, value);
    paintDom();
    root.setPointerCapture(e.pointerId);
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const at = cellFrom(el);
    if (!at) return;
    cursor = at;
    mask = applyRect(drag.base, drag.anchor, at, drag.value);
    paintDom();
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    emit();
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('lostpointercapture', endDrag);

  /* клавиатура: стрелки водят курсор, пробел красит, Shift тянет окно */

  root.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (step) {
      e.preventDefault();
      const row = Math.min(6, Math.max(0, cursor.row + step[0]));
      const col = Math.min(COLS - 1, Math.max(0, cursor.col + step[1]));
      const moved = row !== cursor.row || col !== cursor.col;
      cursor = { row, col };
      if (e.shiftKey && moved) {
        mask[row * COLS + col] = 1;
        emit();
      }
      paintDom();
      cells[cursor.row][cursor.col].focus();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const i = cursor.row * COLS + cursor.col;
      mask[i] = mask[i] === 1 ? 0 : 1;
      paintDom();
      emit();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      cursor = { row: cursor.row, col: e.key === 'Home' ? 0 : COLS - 1 };
      paintDom();
      cells[cursor.row][cursor.col].focus();
    }
  });

  paintDom();

  return {
    setWindows(windows) {
      mask = windowsToMask(windows);
      paintDom();
    }
  };
}

/* ── список окон: то же состояние словами ────────────────────────────────── */

export function windowsToRows(windows) {
  const bySpan = new Map();
  for (const w of windows) {
    const key = `${w.from}-${w.to}`;
    if (!bySpan.has(key)) bySpan.set(key, { from: w.from, to: w.to, days: [] });
    bySpan.get(key).days.push(w.day);
  }
  return [...bySpan.values()].map((r) => ({ ...r, days: r.days.sort((a, b) => a - b) }));
}

export function rowsToWindows(rows) {
  const out = [];
  for (const r of rows) {
    if (!r.days.length || r.to <= r.from) continue;
    for (const day of r.days) out.push({ day, from: r.from, to: r.to });
  }
  return out;
}

const TIMES = (() => {
  const list = [];
  for (let t = GRID.dayStart; t <= GRID.dayEnd; t += GRID.step) list.push(t);
  return list;
})();

function timeSelect(value, label, onPick) {
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', label);
  for (const t of TIMES) {
    const opt = document.createElement('option');
    opt.value = String(t);
    opt.textContent = time(t);
    if (t === value) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onPick(Number(sel.value)));
  return sel;
}

export function createList(root, getWindows, setWindows) {
  function render() {
    const rows = windowsToRows(getWindows());
    root.textContent = '';

    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'panel__hint';
      p.style.margin = '0';
      p.textContent = 'Окон нет — показываем любое расписание.';
      root.append(p);
    }

    rows.forEach((row, i) => {
      const line = document.createElement('div');
      line.className = 'altrow';

      const days = document.createElement('div');
      days.className = 'daypick';
      for (let d = 1; d <= 7; d++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = DAY_SHORT[d];
        b.setAttribute('aria-pressed', row.days.includes(d) ? 'true' : 'false');
        b.setAttribute('aria-label', DAY_FULL[d]);
        b.addEventListener('click', () => {
          const next = windowsToRows(getWindows());
          const target = next[i];
          target.days = target.days.includes(d) ? target.days.filter((x) => x !== d) : [...target.days, d];
          setWindows(rowsToWindows(next));
        });
        days.append(b);
      }
      line.append(days);

      const from = document.createElement('span');
      from.textContent = 'не раньше';
      line.append(from, timeSelect(row.from, 'Начало окна', (v) => {
        const next = windowsToRows(getWindows());
        next[i].from = v;
        if (next[i].to <= v) next[i].to = Math.min(GRID.dayEnd, v + GRID.step);
        setWindows(rowsToWindows(next));
      }));

      const to = document.createElement('span');
      to.textContent = 'не позже';
      line.append(to, timeSelect(row.to, 'Конец окна', (v) => {
        const next = windowsToRows(getWindows());
        next[i].to = v;
        if (next[i].from >= v) next[i].from = Math.max(GRID.dayStart, v - GRID.step);
        setWindows(rowsToWindows(next));
      }));

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'kid__drop';
      drop.textContent = 'Убрать';
      drop.addEventListener('click', () => {
        const next = windowsToRows(getWindows()).filter((_, j) => j !== i);
        setWindows(rowsToWindows(next));
      });
      line.append(drop);

      root.append(line);
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--quiet';
    add.textContent = 'Добавить окно';
    add.addEventListener('click', () => {
      const next = windowsToRows(getWindows());
      next.push({ days: [1, 2, 3, 4, 5], from: 960, to: 1170 });
      setWindows(rowsToWindows(next));
    });
    root.append(add);
  }

  return { render };
}

// Словами — для aria-live и для мобильного экрана, где сетки нет.
export function describeWindows(windows) {
  const rows = windowsToRows(windows);
  if (!rows.length) return 'Окна не заданы: показываем любое расписание.';
  return rows
    .map((r) => {
      const days = r.days.map((d) => DAY_SHORT[d]).join(', ');
      return `${days} ${time(r.from)}—${time(r.to)}`;
    })
    .join('; ');
}
