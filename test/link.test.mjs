// Вход по ссылке на бота.
//
// Проверяется не «работает ли кнопка», а те места, где ошибка означает
// чужой вход: секрет вебхука, совпадение того, кто жал Start, с тем, кто жал
// «Подтвердить», одноразовость заявки и то, что до подтверждения сессии нет.
//
// Сеть не нужна: обращения к Bot API перехвачены, хранилище работает
// в памяти, потому что переменные Upstash не заданы.

import test from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'webhook-secret-for-tests';
process.env.TELEGRAM_BOT_TOKEN = '7654321:AAFakeTokenForTestsOnly';
process.env.TELEGRAM_BOT_USERNAME = 'peresmenka_test_bot';
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
process.env.SITE_ORIGIN = 'http://localhost:5180';

/* ── Bot API наружу не уходит ────────────────────────────────────────────── */

const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: sent.length } }) };
};
const lastCall = (method) => [...sent].reverse().find((c) => c.url.endsWith('/' + method));

const linkHandler = (await import('../api/auth/link.mjs')).default;
const hookHandler = (await import('../api/tg/webhook.mjs')).default;
const meHandler = (await import('../api/me.mjs')).default;

/* ── обвязка ─────────────────────────────────────────────────────────────── */

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      this.body = chunk == null ? '' : String(chunk);
    }
  };
}

async function call(handler, { method = 'GET', url = '/', body, cookie, headers = {}, origin = 'http://localhost:5180' } = {}) {
  const req = { method, url, headers: { origin, ...(cookie ? { cookie } : {}), ...headers }, body };
  const res = makeRes();
  await handler(req, res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, json, headers: res.headers };
}

const hook = (update, secret = SECRET) =>
  call(hookHandler, {
    method: 'POST',
    url: '/api/tg/webhook/',
    body: update,
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }
  });

const start = () => call(linkHandler, { method: 'POST', url: '/api/auth/link/', body: {} });
const poll = (nonce) => call(linkHandler, { method: 'GET', url: `/api/auth/link/?nonce=${encodeURIComponent(nonce)}` });

const person = (id, name) => ({ id, is_bot: false, first_name: name });
const startMsg = (nonce, from) => ({ message: { chat: { id: from.id }, from, text: `/start ${nonce}` } });
const press = (nonce, from, what = 'ok') => ({
  callback_query: { id: 'cb' + Math.random(), from, data: `${what}:${nonce}`, message: { chat: { id: from.id }, message_id: 1 } }
});

/* ── секрет вебхука ──────────────────────────────────────────────────────── */

test('вебхук без секрета не отвечает', async () => {
  const res = await hook({ message: { chat: { id: 1 }, from: person(1, 'Аноним'), text: '/start' } }, null);
  assert.equal(res.status, 401);
});

test('вебхук с чужим секретом не отвечает', async () => {
  const res = await hook({ message: { chat: { id: 1 }, from: person(1, 'Аноним'), text: '/start' } }, 'не тот секрет');
  assert.equal(res.status, 401);
});

test('секрет правильной длины, но другой — тоже мимо', async () => {
  const wrong = 'X'.repeat(SECRET.length);
  const res = await hook({ message: { chat: { id: 1 }, from: person(1, 'Аноним'), text: '/start' } }, wrong);
  assert.equal(res.status, 401);
});

test('чужой POST не доходит до разбора тела', async () => {
  const before = sent.length;
  await hook({ message: { chat: { id: 1 }, from: person(1, 'Аноним'), text: '/start' } }, null);
  assert.equal(sent.length, before, 'бот не должен ничего отправлять по чужому запросу');
});

/* ── обычный путь ────────────────────────────────────────────────────────── */

test('весь путь: заявка, Start, подтверждение, сессия', async () => {
  const made = await start();
  assert.equal(made.status, 200);
  const { nonce, code, url } = made.json;
  assert.match(url, /^https:\/\/t\.me\/peresmenka_test_bot\?start=/);
  assert.match(code, /^[A-Z0-9]{4}$/);

  // До Start заявка ничего не выдаёт.
  const early = await poll(nonce);
  assert.equal(early.json.status, 'pending');
  assert.equal(early.headers['set-cookie'], undefined, 'сессии до подтверждения быть не должно');

  // Start: бот спрашивает подтверждение и показывает тот же код.
  await hook(startMsg(nonce, person(500100, 'Ивана')));
  const ask = lastCall('sendMessage');
  assert.ok(ask.body.text.includes(code), 'в сообщении бота должен быть код сверки');
  assert.ok(ask.body.reply_markup, 'должны быть кнопки');

  const asked = await poll(nonce);
  assert.equal(asked.json.status, 'asked');
  assert.equal(asked.headers['set-cookie'], undefined);

  // Подтверждение.
  await hook(press(nonce, person(500100, 'Ивана')));
  const done = await poll(nonce);
  assert.equal(done.json.status, 'ok');
  assert.equal(done.json.user.first_name, 'Ивана');

  const cookie = done.headers['set-cookie'].split(';')[0];
  const mine = await call(meHandler, { cookie });
  assert.equal(mine.json.user.id, 500100, 'сессия должна принадлежать тому, кто подтвердил');
});

test('заявка одноразовая: второй раз по ней не войти', async () => {
  const { nonce } = (await start()).json;
  await hook(startMsg(nonce, person(500200, 'Пётр')));
  await hook(press(nonce, person(500200, 'Пётр')));

  const first = await poll(nonce);
  assert.equal(first.json.status, 'ok');
  const second = await poll(nonce);
  assert.equal(second.json.status, 'expired');
  assert.equal(second.headers['set-cookie'], undefined);
});

/* ── подмена ─────────────────────────────────────────────────────────────── */

test('подтвердить может только тот, кто нажимал Start', async () => {
  const { nonce } = (await start()).json;
  await hook(startMsg(nonce, person(500300, 'Хозяин')));
  await hook(press(nonce, person(500999, 'Чужой')));

  const res = await poll(nonce);
  assert.equal(res.json.status, 'asked', 'чужое нажатие не должно подтверждать заявку');
  assert.equal(res.headers['set-cookie'], undefined);
});

test('вторым Start заявку не перехватить', async () => {
  const { nonce } = (await start()).json;
  await hook(startMsg(nonce, person(500400, 'Хозяин')));
  await hook(startMsg(nonce, person(500999, 'Чужой')));
  // Даже если перехватчик нажмёт кнопку, заявка помнит первого.
  await hook(press(nonce, person(500999, 'Чужой')));
  assert.equal((await poll(nonce)).json.status, 'asked');

  await hook(press(nonce, person(500400, 'Хозяин')));
  const res = await poll(nonce);
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.user.id, 500400);
});

test('«это не я» уничтожает заявку', async () => {
  const { nonce } = (await start()).json;
  await hook(startMsg(nonce, person(500500, 'Жертва')));
  await hook(press(nonce, person(500500, 'Жертва'), 'no'));
  assert.equal((await poll(nonce)).json.status, 'expired');
});

test('выдуманный nonce ничего не даёт', async () => {
  for (const bad of ['', 'короткий', '../../sess/abcdef0123456789', 'A'.repeat(200)]) {
    const res = await poll(bad);
    assert.equal(res.json.status, 'expired');
    assert.equal(res.headers['set-cookie'], undefined);
  }
});

test('Start с мусором вместо заявки не создаёт ничего', async () => {
  const before = sent.length;
  await hook(startMsg('../../users', person(500600, 'Любопытный')));
  const reply = sent.slice(before).find((c) => c.url.endsWith('/sendMessage'));
  assert.ok(reply, 'ответить надо');
  assert.ok(!reply.body.reply_markup, 'но кнопок подтверждения быть не должно');
});

/* ── настройка ───────────────────────────────────────────────────────────── */

test('без имени бота заявку завести нельзя', async () => {
  const saved = process.env.TELEGRAM_BOT_USERNAME;
  delete process.env.TELEGRAM_BOT_USERNAME;
  const res = await start();
  process.env.TELEGRAM_BOT_USERNAME = saved;
  assert.equal(res.status, 503);
});

test('чужой источник не заводит заявку', async () => {
  const res = await call(linkHandler, { method: 'POST', url: '/api/auth/link/', body: {}, origin: 'https://zlo.example' });
  assert.equal(res.status, 403);
});

test('заявки нельзя штамповать бесконечно', async () => {
  const from = { 'x-forwarded-for': '203.0.113.7' };
  const mine = () => call(linkHandler, { method: 'POST', url: '/api/auth/link/', body: {}, headers: from });

  let refused = 0;
  for (let i = 0; i < 25; i++) if ((await mine()).status === 429) refused++;
  assert.ok(refused >= 4, `после двадцати попыток должен быть отказ, отказов ${refused}`);

  // Чужой адрес это не задевает.
  const other = await call(linkHandler, { method: 'POST', url: '/api/auth/link/', body: {}, headers: { 'x-forwarded-for': '198.51.100.3' } });
  assert.equal(other.status, 200);
});

test('оба входа дают одинаковый профиль', async () => {
  const { profileFrom } = await import('../api/_lib/link.mjs');
  const p = profileFrom({ id: 42, is_bot: false, first_name: 'Аня', last_name: 'П', username: 'anya', language_code: 'ru' });
  assert.deepEqual(Object.keys(p).sort(), ['first_name', 'id', 'last_name', 'username']);
  assert.equal(profileFrom({ id: 42, is_bot: true, first_name: 'Бот' }), null, 'бота пускать некуда');
  assert.equal(profileFrom({ id: 0 }), null);
});
