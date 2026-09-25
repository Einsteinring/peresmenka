// Снимки для design/compare.html: эталон и сайт, секция за секцией.
//
//   node tools/shoot-compare.mjs
//
// Поднимает свой сервер и установленный Edge (как сценарии в test/ui),
// режет обе страницы по границам секций и кладёт кадры в design/compare/.
// Границы берутся из самих страниц: у эталона — его <header> и <section>,
// у сайта — те же блоки по порядку. Поэтому кадры сопоставимы по смыслу,
// даже если высоты разные.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBrowser, startSite } from '../test/ui/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'design', 'compare');
mkdirSync(OUT, { recursive: true });

// Какие секции сравниваем на этой контрольной точке.
const SECTIONS = ['header', 'hero', 'tiles', 'steps', 'results', 'footer'];

const site = await startSite();
const browser = await startBrowser();

async function cut(page, name, bounds, width) {
  const out = {};
  for (const key of SECTIONS) {
    const [y0, y1] = bounds[key];
    const file = `${name}-${key}.png`;
    writeFileSync(join(OUT, file), await page.shot(y0, y1 - y0, width));
    out[key] = { file, height: Math.round(y1 - y0) };
  }
  return out;
}

const top = (sel) => `document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top + scrollY`;
const bottom = (sel) => `document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().bottom + scrollY`;

// ── эталон ──
const ref = await browser.open(`${site.origin}/design/reference.html`, { width: 1440, height: 2600 });
await ref.waitFor('document.fonts.status === "loaded"');
const refB = await ref.eval(`(() => {
  const s = document.querySelectorAll('section');
  const t = (e) => e.getBoundingClientRect().top + scrollY;
  return { header: [0, t(s[0])], hero: [t(s[0]), t(s[1])], tiles: [t(s[1]), t(s[2])], steps: [t(s[2]), t(s[3])],
    results: [t(s[3]), t(document.querySelector('footer'))],
    footer: [t(document.querySelector('footer')), document.querySelector('footer').getBoundingClientRect().bottom + scrollY] };
})()`);
const refShots = await cut(ref, 'ref', refB, 1440);

// ── сайт, гость ──
const mine = await browser.open(`${site.origin}/`, { width: 1440, height: 2600 });
await mine.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
const mineB = await mine.eval(`({
  header: [0, ${top('.hero')}],
  hero: [${top('.hero')}, ${top('#napravleniya')}],
  tiles: [${top('#napravleniya')}, ${top('#podbor')}],
  steps: [${top('#podbor')}, ${top('#gruppy')}],
  results: [${top('#gruppy')}, ${top('.foot')}],
  footer: [${top('.foot')}, ${bottom('.foot')}]
})`);
const mineShots = await cut(mine, 'site', mineB, 1440);
// Подвал — в самом низу длинной страницы: снимок «за пределами окна» его
// сдвигает. Прокручиваем к нему и снимаем заново, уже в пределах окна.
{
  await mine.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
  await new Promise((r) => setTimeout(r, 300));
  const [y0, y1] = await mine.eval(`[${top('.foot')}, ${bottom('.foot')}]`);
  writeFileSync(join(OUT, 'site-footer.png'), await mine.shot(y0, y1 - y0, 1440));
  mineShots.footer = { file: 'site-footer.png', height: Math.round(y1 - y0) };
}

// ── шаги в заполненном состоянии, как нарисовано в эталоне: ребёнок 8 лет
//    и пресет «После школы» ──
{
  const f = await browser.open(`${site.origin}/?kids=8`, { width: 1440, height: 2600 });
  await f.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  await f.click(`__ui.text('button', '^после школы')`);
  await f.waitFor('new URLSearchParams(location.search).get("win")');
  const b = await f.eval(`[${top('#podbor')}, ${top('#gruppy')}]`);
  writeFileSync(join(OUT, 'site-steps-filled.png'), await f.shot(b[0], b[1] - b[0], 1440));
}

// ── результаты в состояниях, которых в эталоне нет ──
async function resultsShot(path, file, height, prep) {
  const p = await browser.open(`${site.origin}${path}`, { width: 1440, height: 2600 });
  await p.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  if (prep) await prep(p);
  const y = await p.eval(top('#gruppy'));
  writeFileSync(join(OUT, file), await p.shot(y, height, 1440));
  await p.close();
}
// двое детей и окно: «обоих сразу», полосы занятий, возраст по каждому
await resultsShot('/?kids=7,10', 'site-results-kids.png', 1500, async (p) => {
  await p.click(`__ui.text('button', '^после школы')`);
  await p.waitFor('/обоих в одно время/i.test(document.body.innerText)');
});
// пусто: подсказки с числами и «почти подходит»
await resultsShot('/?kids=3&dir=plavanie', 'site-results-empty.png', 900);
// сравнение: две группы отмечены, таблица открыта
{
  const p = await browser.open(`${site.origin}/?kids=8`, { width: 1440, height: 900 });
  await p.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  await p.eval(`document.getElementById('gruppy').scrollIntoView()`);
  await p.click(`__ui.text('label', '^сравнить$', 0)`);
  await p.click(`__ui.text('label', '^сравнить$', 1)`);
  await new Promise((r) => setTimeout(r, 200));
  writeFileSync(join(OUT, 'site-results-cmpbar.png'), await p.shotViewport());
  await p.click(`__ui.all('button').filter((b) => /^сравнить$/i.test(__ui.norm(b.textContent))).pop()`);
  await p.waitFor(`!!document.querySelector('dialog[open] table')`);
  await new Promise((r) => setTimeout(r, 200));
  writeFileSync(join(OUT, 'site-results-cmp.png'), await p.shotViewport());
  await p.close();
}

// ── статика и кабинет: в эталоне их нет, снимаются в том же языке ──
// Страница группы грузит карту OpenStreetMap: через прокси она иногда не
// успевает, поэтому кадр снимается со второй попытки, а не роняет сборку.
async function pageShot(path, file, width, height) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const p = await browser.open(`${site.origin}${path}`, { width, height: Math.min(height, 1400), mobile: width < 600 });
      await p.waitFor('document.fonts.status === "loaded"');
      await new Promise((r) => setTimeout(r, 500));
      const h = await p.eval(`Math.min(${height}, document.documentElement.scrollHeight)`);
      writeFileSync(join(OUT, file), await p.shot(0, h, width));
      await p.close();
      return;
    } catch (err) {
      if (attempt) throw err;
    }
  }
}
for (const [path, name] of [
  ['/shahmaty/', 'static-list'],
  ['/g/g001-shahmaty-endshpil-parnas/', 'static-group'],
  ['/lk/?demo=1', 'lk'],
  ['/lk/?demo=1&tab=saves', 'lk-saves'],
  ['/lk/', 'lk-guest']
]) {
  await pageShot(path, `site-${name}.png`, 1440, name.startsWith('lk') ? 1300 : 1800);
  if (!name.startsWith('lk-')) await pageShot(path, `site-390-${name}.png`, 390, 1600);
}

// ── сайт, вошедший (демо): колокольчик и профиль как в эталоне ──
const demo = await browser.open(`${site.origin}/?demo=1`, { width: 1440, height: 1200 });
await demo.waitFor('!!document.querySelector(".profile") && document.fonts.status === "loaded"');
const demoTop = await demo.eval(top('.hero'));
writeFileSync(join(OUT, 'site-header-demo.png'), await demo.shot(0, demoTop, 1440));

// ── телефон ──
const phones = [];
for (const [w, h] of [[390, 844], [360, 740]]) {
  const p = await browser.open(`${site.origin}/`, { width: w, height: h, mobile: true });
  await p.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  const overflow = await p.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  const end = await p.eval(`${bottom('#napravleniya')} + 24`);
  const file = `site-${w}.png`;
  writeFileSync(join(OUT, file), await p.shot(0, end, w));
  // Длинные имена в плитках: не вылезают ли за край плитки.
  const spill = await p.eval(`[...document.querySelectorAll('.tile')].filter((t) => {
    const n = t.querySelector('.tile__name'); return n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > t.getBoundingClientRect().right;
  }).map((t) => t.querySelector('.tile__name').textContent)`);
  phones.push({ w, file, overflow, spill });
}

// Телефон после прокрутки: кнопка героя ушла за край — появилась полоса.
{
  const p = await browser.open(`${site.origin}/`, { width: 390, height: 844, mobile: true });
  await p.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  await p.wheel(1200);
  await p.waitFor('document.getElementById("mobilebar").dataset.away === "1"');
  await new Promise((r) => setTimeout(r, 400));
  writeFileSync(join(OUT, 'site-390-scrolled.png'), await p.shotViewport());
  await p.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
  await new Promise((r) => setTimeout(r, 400));
  writeFileSync(join(OUT, 'site-390-end.png'), await p.shotViewport());
}

// ── результаты на телефоне: панель и первая карточка; двое детей с окном ──
for (const [path, file, prep] of [
  ['/', 'site-390-results.png'],
  ['/?kids=7,10', 'site-390-results-kids.png', async (p) => {
    await p.eval(`document.querySelector('[data-preset]').click()`);
    await p.waitFor('/обоих в одно время/i.test(document.body.innerText)');
  }]
]) {
  const p = await browser.open(`${site.origin}${path}`, { width: 390, height: 844, mobile: true });
  await p.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  if (prep) await prep(p);
  const y = await p.eval(top('#gruppy'));
  writeFileSync(join(OUT, file), await p.shot(y, 1500, 390));
  await p.close();
}

// ── шторка на телефоне: открыта, наверху и прокрученная к шагу 3 ──
{
  const p = await browser.open(`${site.origin}/?kids=8`, { width: 390, height: 844, mobile: true });
  await p.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  await p.click(`__ui.text('a, button', '^подобрать кружок')`);
  await p.waitFor('document.getElementById("builder").dataset.sheet === "open"');
  await new Promise((r) => setTimeout(r, 400));
  writeFileSync(join(OUT, 'site-390-sheet.png'), await p.shotViewport());
  await p.eval('document.getElementById("builder").scrollTop = document.querySelector(".step--when").offsetTop - 70');
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(join(OUT, 'site-390-sheet-2.png'), await p.shotViewport());
  await p.eval('document.getElementById("builder").scrollTop = document.querySelector(".step--where").offsetTop - 70');
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(join(OUT, 'site-390-sheet-3.png'), await p.shotViewport());
}

// ── ноутбуки: 1366 и 1280 — верх страницы до конца витрины и шаги ──
const laptops = [];
for (const w of [1366, 1280]) {
  const p = await browser.open(`${site.origin}/`, { width: w, height: 2400 });
  await p.waitFor('document.querySelectorAll(".tile").length === 9 && document.fonts.status === "loaded"');
  const facts = await p.eval(`(() => {
    const tiles = [...document.querySelectorAll('.tile')];
    const rows = new Set(tiles.map((t) => Math.round(t.offsetTop))).size;
    // Строки имени — по разным верхам прямоугольников текста.
    const lines = (n) => { const r = document.createRange(); r.selectNodeContents(n);
      return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; };
    const broken = tiles.map((t) => t.querySelector('.tile__name')).filter((n) => lines(n) > 1)
      .map((n) => n.textContent.replace(/\\u00ad/g, ''));
    return { rows, broken, overflow: document.documentElement.scrollWidth - innerWidth };
  })()`);
  const end = await p.eval(`${bottom('#napravleniya')} + 24`);
  const file = `site-${w}.png`;
  writeFileSync(join(OUT, file), await p.shot(0, end, w));
  const s = await p.eval(`[${top('#podbor')}, ${top('#gruppy')}]`);
  const steps = `site-steps-${w}.png`;
  writeFileSync(join(OUT, steps), await p.shot(s[0], s[1] - s[0], w));
  laptops.push({ w, file, steps, ...facts });
  await p.close();
}

const tilesSpill1440 = await mine.eval(`[...document.querySelectorAll('.tile')].filter((t) => {
  const n = t.querySelector('.tile__name'); return n.scrollWidth > n.clientWidth + 1;
}).map((t) => t.querySelector('.tile__name').textContent)`);

writeFileSync(join(OUT, 'shots.json'), JSON.stringify({ refShots, mineShots, phones, laptops, tilesSpill1440 }, null, 2));
console.log(JSON.stringify({ refB, mineB, phones, laptops, tilesSpill1440 }, null, 2));

await browser.stop();
site.stop();
process.exit(0);
