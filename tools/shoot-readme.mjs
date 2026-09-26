// Скриншоты для README: docs/screenshots/*.png.
//
//   node tools/shoot-readme.mjs
//
// Поднимает свой сервер и Edge, как сценарии в test/ui: ключи Upstash и
// Telegram пустые, поэтому ничего не пишется в боевую базу и не уходит
// настоящему боту, — кабинет снимается в демо-режиме, вход — с тестовым
// именем бота. Размеры те же, что были: широкие кадры 1440 px, телефонные —
// 390 px с двойной плотностью (780 px в файле).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBrowser, startSite } from '../test/ui/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

const site = await startSite();
const browser = await startBrowser();
const ready = `document.fonts.status === 'loaded'`;
const home = `${ready} && document.querySelectorAll('.dtiles .tile').length === 9 && !!document.querySelector('.head__me .profile, .head__me .bell')`;
const topOf = (sel, pad = 0) => `document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top + scrollY - ${pad}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Один кадр: открыть, дождаться, подготовить, снять полосу страницы.
async function frame(file, path, { width = 1440, height = 900, phone = false, wait = ready, prep, from = '0', scale } = {}) {
  const viewH = phone ? 844 : Math.max(900, height);
  const page = await browser.open(site.origin + path, { width, height: viewH, mobile: phone });
  await page.waitFor(wait, { timeout: 20000, what: `${file}: страница готова` });
  if (prep) await prep(page);
  await pause(400);
  const y = Math.max(0, Math.round(await page.eval(from)));
  // Полоса снимается в пределах окна, если влезает: так закреплённые
  // элементы (шторка, полосы) остаются на своих местах.
  if (height <= viewH) await page.eval(`window.scrollTo(0, ${y})`);
  await pause(300);
  const at = height <= viewH ? await page.eval('scrollY') : y;
  writeFileSync(join(OUT, file), await page.shot(at, height, width, scale ?? (phone ? 2 : 1)));
  if (page.errors.length) console.warn(`${file}: ошибки в консоли — ${page.errors.join(' | ')}`);
  await page.close();
  console.log('готово', file);
}

const presetAfterSchool = async (page) => {
  await page.click(`__ui.text('button', '^после школы')`);
  await page.waitFor(`!!new URLSearchParams(location.search).get('win')`);
};

// ── главная ──
await frame('tiles-1440.png', '/', { wait: home });
await frame('search-1440.png', '/?kids=8', {
  wait: home, height: 1400, prep: presetAfterSchool, from: topOf('#podbor', 24)
});
await frame('empty-1440.png', '/?kids=3&dir=plavanie', { wait: home, from: topOf('#gruppy', 24) });
await frame('together-1440.png', '/?kids=7,10', {
  wait: home, from: topOf('#gruppy', 24),
  prep: async (page) => {
    await presetAfterSchool(page);
    await page.waitFor(`/обоих в одно время/i.test(document.body.innerText)`);
  }
});

// Вход: панель в потоке под результатами, затем экран с кодом сверки.
await frame('login-1440.png', '/?kids=8', {
  wait: home, from: topOf('#gruppy', 24),
  prep: async (page) => {
    await page.click(`__ui.text('button', '^сохранить поиск')`);
    await page.waitFor(`/нужен вход/i.test(document.body.innerText)`);
  }
});
await frame('login-app-1440.png', '/?kids=8', {
  wait: home, from: topOf('#gruppy', 24),
  prep: async (page) => {
    await page.click(`__ui.text('button', '^сохранить поиск')`);
    await page.click(`__ui.text('button', 'через приложение telegram')`);
    await page.waitFor(`!!document.querySelector('.login__code') && document.querySelector('.login__code').textContent.trim().length > 0`);
  }
});

// ── статика ──
await frame('seo-1440.png', '/plavanie/8-let/sportivnaya/');
await frame('group-1440.png', '/g/g001-shahmaty-endshpil-parnas/', { height: 1000 });

// ── кабинет (демо) ──
await frame('lk-1440.png', '/lk/?demo=1', { wait: `${ready} && !!document.querySelector('.lkc')` });
await frame('lk-bell-1440.png', '/lk/?demo=1', {
  height: 760, wait: `${ready} && !!document.querySelector('.lkc') && !!document.querySelector('.bell__btn')`,
  prep: async (page) => {
    await page.click(`document.querySelector('.bell__btn')`);
    await page.waitFor(`!!document.querySelector('.bell__drop') && !document.querySelector('.bell__drop').hidden`);
  }
});
await frame('lk-favs-1440.png', '/lk/?demo=1&tab=favs', { wait: `${ready} && !!document.querySelector('.lkc')` });

// ── телефон ──
await frame('search-390.png', '/?kids=8', { width: 390, height: 844, phone: true, wait: home, from: topOf('#gruppy', 12) });
await frame('sheet-390.png', '/?kids=8', {
  width: 390, height: 844, phone: true, wait: home,
  prep: async (page) => {
    await page.click(`__ui.text('a, button', '^подобрать кружок')`);
    await page.waitFor(`document.getElementById('builder').dataset.sheet === 'open'`);
  }
});
await frame('lk-390.png', '/lk/?demo=1', { width: 390, height: 1100, phone: true, wait: `${ready} && !!document.querySelector('.lkc')` });
await frame('seo-390.png', '/plavanie/8-let/sportivnaya/', { width: 390, height: 844, phone: true });

await browser.stop();
site.stop();
process.exit(0);
