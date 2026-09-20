// Кабинет: подпись Telegram, владение объектами, тихие часы, имена поисков.
//
// Сеть здесь не нужна ни разу: подпись считается локально тем же алгоритмом,
// что и в Telegram, а хранилище работает в памяти, потому что переменные
// Upstash в тестах не заданы. Это важно: api.telegram.org с машины разработки
// может быть недоступен, и тесты от этого зависеть не должны.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { checkLogin } from '../api/_lib/telegram.mjs';
import { inQuietHours, minutesInPiter, sendAfter } from '../api/_lib/notify.mjs';
import { describeQuery } from '../js/describe.js';
import { buildIndex, GRID } from '../js/model.js';
import { parseQuery } from '../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOT = '7654321:AAFakeTokenForTestsOnly';
process.env.TELEGRAM_BOT_TOKEN = BOT;
process.env.SITE_ORIGIN = 'http://localhost:5180';

/* ── подпись ─────────────────────────────────────────────────────────────── */

function sign(fields, token = BOT) {
  const checkString = Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest();
  return createHmac('sha256', secret).update(checkString).digest('hex');
}

const freshLogin = (extra = {}) => {
  const base = { id: 555001, first_name: 'Иван', username: 'ivan', auth_date: Math.floor(Date.now() / 1000), ...extra };
  return { ...base, hash: sign(base) };
};

test('правильная подпись проходит и отдаёт профиль', () => {
  const res = checkLogin(freshLogin(), BOT);
  assert.equal(res.ok, true);
  assert.equal(res.profile.id, 555001);
  assert.equal(res.profile.first_name, 'Иван');
  // auth_date в профиль не попадает — это не свойство человека
  assert.equal(res.profile.auth_date, undefined);
});

test('подделка любого поля ломает подпись', () => {
  for (const field of ['id', 'first_name', 'username', 'auth_date']) {
    const data = freshLogin();
    data[field] = field === 'id' ? 999999 : `${data[field]}x`;
    const res = checkLogin(data, BOT);
    assert.equal(res.ok, false, `подмена ${field} прошла`);
  }
});

test('добавленное поле ломает подпись', () => {
  const data = freshLogin();
  data.photo_url = 'https://example.invalid/a.jpg';
  assert.equal(checkLogin(data, BOT).ok, false);
});

test('подпись чужим токеном не проходит', () => {
  const base = { id: 1, first_name: 'A', auth_date: Math.floor(Date.now() / 1000) };
  const data = { ...base, hash: sign(base, 'другой:токен') };
  assert.equal(checkLogin(data, BOT).ok, false);
});

test('вход старше суток не проходит', () => {
  const old = Math.floor(Date.now() / 1000) - 86401;
  const res = checkLogin(freshLogin({ auth_date: old }), BOT);
  assert.equal(res.ok, false);
  assert.match(res.reason, /просроч/);
});

test('ровно сутки без секунды ещё проходят', () => {
  const at = Math.floor(Date.now() / 1000) - 86399;
  assert.equal(checkLogin(freshLogin({ auth_date: at }), BOT).ok, true);
});

test('auth_date из будущего не проходит', () => {
  const at = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(checkLogin(freshLogin({ auth_date: at }), BOT).ok, false);
});

test('без hash и с мусором вместо hash не проходит', () => {
  const data = freshLogin();
  delete data.hash;
  assert.equal(checkLogin(data, BOT).ok, false);
  assert.equal(checkLogin({ ...freshLogin(), hash: 'нехекс' }, BOT).ok, false);
  assert.equal(checkLogin({ ...freshLogin(), hash: 'ab' }, BOT).ok, false);
});

test('без токена бота вход невозможен', () => {
  assert.equal(checkLogin(freshLogin(), '').ok, false);
});

/* ── тихие часы ──────────────────────────────────────────────────────────── */

const quiet = { from: 22 * 60, to: 8 * 60 };
// 2026-09-20T20:10:00Z — это 23:10 в Петербурге
const atNight = new Date('2026-09-20T20:10:00Z');
// 2026-09-20T11:00:00Z — это 14:00 в Петербурге
const atDay = new Date('2026-09-20T11:00:00Z');

test('петербургское время считается по зоне, а не по смещению сервера', () => {
  assert.equal(minutesInPiter(atNight), 23 * 60 + 10);
  assert.equal(minutesInPiter(atDay), 14 * 60);
});

test('ночью сообщение откладывается до восьми утра', () => {
  assert.equal(inQuietHours(quiet, atNight), true);
  const after = new Date(sendAfter(quiet, atNight));
  assert.equal(minutesInPiter(after), 8 * 60);
  assert.ok(after > atNight);
});

test('днём сообщение уходит сразу', () => {
  assert.equal(inQuietHours(quiet, atDay), false);
  assert.equal(sendAfter(quiet, atDay), null);
});

test('граница включительно снизу и исключительно сверху', () => {
  const at22 = new Date('2026-09-20T19:00:00Z'); // 22:00 в Петербурге
  const at8 = new Date('2026-09-21T05:00:00Z'); // 08:00 в Петербурге
  assert.equal(inQuietHours(quiet, at22), true);
  assert.equal(inQuietHours(quiet, at8), false);
});

/* ── имена сохранённых поисков ───────────────────────────────────────────── */

const index = buildIndex(
  JSON.parse(readFileSync(join(ROOT, 'data', 'catalog.json'), 'utf8')),
  JSON.parse(readFileSync(join(ROOT, 'data', 'geo.json'), 'utf8'))
);

test('имя поиска собирается из фильтров', () => {
  const q = parseQuery('?kids=8&win=12345:1080-1320&geo=metro&m=petrogradskaya');
  assert.equal(describeQuery(q, index), '8 лет, будни после 18:00, Петроградская');
});

test('двое детей и выходные', () => {
  const q = parseQuery('?kids=6,9&win=67:540-900');
  assert.equal(describeQuery(q, index), 'Дети 6 и 9, выходные 09:00—15:00');
});

test('направление, радиус и строгий режим попадают в имя', () => {
  const q = parseQuery('?dir=plavanie&kids=7&geo=near&at=59.92700,30.31990&place=%D0%A1%D0%B5%D0%BD%D0%BD%D0%B0%D1%8F&rad=2000');
  const name = describeQuery(q, index);
  assert.match(name, /^Плавание, 7 лет, рядом с «Сенная», 2 км$/);
});

test('пустой запрос называется целым каталогом', () => {
  assert.equal(describeQuery(parseQuery(''), index), 'Весь каталог');
});

test('окно на весь день не выдаёт «после 07:00»', () => {
  const q = parseQuery(`?win=1:${GRID.dayStart}-${GRID.dayEnd}`);
  assert.match(describeQuery(q, index), /^Пн в любое время$/);
});
