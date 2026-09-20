// Проверки по уже собранным страницам. Если сборки не было — тесты
// пропускаются, а не падают: `npm test` должен работать на чистом клоне.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = join(ROOT, 'sitemap.xml');
const built = existsSync(SITEMAP);
const skip = built ? false : 'страницы не собраны: сначала npm run build';

function urls() {
  return [...readFileSync(SITEMAP, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

const readPage = (u) => readFileSync(join(ROOT, u, 'index.html'), 'utf8');

test('каждый адрес из sitemap лежит на диске', { skip }, () => {
  for (const u of urls()) {
    assert.ok(existsSync(join(ROOT, u, 'index.html')), `нет файла для ${u}`);
  }
});

test('на странице-списке не меньше трёх групп', { skip }, () => {
  for (const u of urls()) {
    if (u === '/' || u.startsWith('/g/')) continue;
    const html = readPage(u);
    const rows = (html.match(/<li class="row"[ >]/g) || []).length;
    assert.ok(rows >= 3, `${u}: групп ${rows}`);
  }
});

test('список групп лежит в HTML, а не собирается скриптом', { skip }, () => {
  // Проверяем каждую страницу-список, а не первую попавшуюся: с появлением
  // кабинета соблазн уронить туда скрипт стал реальным.
  for (const u of urls()) {
    if (u === '/' || u.startsWith('/g/')) continue;
    const html = readPage(u);
    assert.match(html, /<li class="row"[ >]/, `${u}: список не в HTML`);
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
    for (const attrs of scripts) {
      assert.match(attrs, /application\/ld\+json/, `на ${u} есть исполняемый скрипт`);
    }
  }
});

test('на страницы-списки не попал ни один обработчик и ни один onclick', { skip }, () => {
  for (const u of urls()) {
    if (u === '/' || u.startsWith('/g/')) continue;
    const html = readPage(u);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${u}: инлайновый обработчик`);
    assert.doesNotMatch(html, /<script[^>]+src=/i, `${u}: внешний скрипт`);
  }
});

test('у каждой страницы свои title, description и canonical', { skip }, () => {
  const titles = new Map();
  const descriptions = new Map();
  for (const u of urls()) {
    const html = readPage(u);
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)[1];

    assert.ok(title.length > 10 && title.length < 130, `${u}: длина title ${title.length}`);
    assert.ok(desc.length > 40, `${u}: короткое описание`);
    assert.ok(canonical.endsWith(u), `${u}: canonical ведёт на ${canonical}`);

    if (titles.has(title)) assert.fail(`одинаковый title у ${u} и ${titles.get(title)}`);
    titles.set(title, u);
    if (descriptions.has(desc)) assert.fail(`одинаковое описание у ${u} и ${descriptions.get(desc)}`);
    descriptions.set(desc, u);
  }
});

test('разметка JSON-LD разбирается и содержит крошки', { skip }, () => {
  for (const u of urls().slice(0, 60)) {
    if (u === '/') continue; // у поиска своя разметка WebSite, крошек нет
    const html = readPage(u);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length >= 2, `${u}: разметки нет`);
    const parsed = blocks.map((b) => JSON.parse(b[1]));
    assert.ok(parsed.some((p) => p['@type'] === 'BreadcrumbList'));
    assert.ok(parsed.some((p) => p['@type'] === 'ItemList' || p['@type'] === 'Course'));
  }
});

test('внутренние ссылки ведут на существующие страницы', { skip }, () => {
  const known = new Set(urls());
  known.add('/');
  // Кабинет в sitemap не попадает намеренно: страница личная и под noindex.
  known.add('/lk/');
  for (const u of urls().slice(0, 120)) {
    const html = readPage(u);
    for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const href = m[1];
      if (href.startsWith('/css/') || href.startsWith('/js/') || href.startsWith('/data/')) continue;
      assert.ok(known.has(href), `${u} ссылается на несуществующий ${href}`);
    }
  }
});

test('на каждой странице есть пометка о демонстрационных данных', { skip }, () => {
  for (const u of urls().slice(0, 80)) {
    assert.match(readPage(u), /вымышлен/i, `${u}: нет пометки`);
  }
});

test('карточек групп ровно столько, сколько групп в каталоге', { skip }, () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'catalog.json'), 'utf8'));
  const dirs = readdirSync(join(ROOT, 'g'));
  assert.equal(dirs.length, catalog.groups.length);
});

test('robots.txt указывает на sitemap', { skip }, () => {
  const robots = readFileSync(join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/[^\s]+\/sitemap\.xml/);
});
