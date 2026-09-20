// Владение объектами кабинета.
//
// Правило, которое здесь проверяется: uid берётся только из сессии. В теле
// запроса поля пользователя нет вообще, поэтому подсунуть чужой id некуда —
// и тест это показывает буквально, подсовывая.
//
// Хранилище в тестах — то же самое, что в проде, но в памяти: переменные
// Upstash не заданы. Сеть не нужна.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

const BOT = '7654321:AAFakeTokenForTestsOnly';
process.env.TELEGRAM_BOT_TOKEN = BOT;
process.env.SITE_ORIGIN = 'http://localhost:5180';

const authHandler = (await import('../api/auth/telegram.mjs')).default;
const savesHandler = (await import('../api/saves.mjs')).default;
const favsHandler = (await import('../api/favs.mjs')).default;
const meHandler = (await import('../api/me.mjs')).default;

/* ── обвязка: вызвать функцию так, как её вызывает Vercel ────────────────── */

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      this.body = chunk == null ? '' : String(chunk);
      this.headersSent = true;
    }
  };
  return res;
}

async function call(handler, { method = 'GET', body, cookie, origin = 'http://localhost:5180' } = {}) {
  const req = {
    method,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    body
  };
  const res = makeRes();
  await handler(req, res);
  let parsed = null;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    parsed = null;
  }
  return { status: res.statusCode, json: parsed, headers: res.headers };
}

function sign(fields) {
  const checkString = Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => k + '=' + fields[k])
    .join('\n');
  const secret = createHash('sha256').update(BOT).digest();
  return createHmac('sha256', secret).update(checkString).digest('hex');
}

async function login(id, name) {
  const base = { id, first_name: name, auth_date: Math.floor(Date.now() / 1000) };
  const res = await call(authHandler, { method: 'POST', body: { ...base, hash: sign(base) } });
  assert.equal(res.status, 200, 'вход должен пройти');
  const setCookie = res.headers['set-cookie'];
  return setCookie.split(';')[0];
}

/* ── тесты ───────────────────────────────────────────────────────────────── */

const alice = await login(700001, 'Алиса');
const bob = await login(700002, 'Борис');

test('гость не видит чужой кабинет и получает 401 на коллекциях', async () => {
  assert.equal((await call(savesHandler)).status, 401);
  assert.equal((await call(favsHandler)).status, 401);
  const me = await call(meHandler);
  assert.equal(me.status, 200);
  assert.equal(me.json.user, null);
});

test('сохранённый поиск виден только своему хозяину', async () => {
  const created = await call(savesHandler, {
    method: 'POST',
    cookie: alice,
    body: { search: '?kids=8&win=12345:1080-1320' }
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.saves.length, 1);

  const mine = await call(savesHandler, { cookie: alice });
  assert.equal(mine.json.saves.length, 1);

  const his = await call(savesHandler, { cookie: bob });
  assert.equal(his.json.saves.length, 0, 'Борис не должен видеть поиск Алисы');
});

test('чужой поиск нельзя удалить: 404, и он остаётся на месте', async () => {
  const id = (await call(savesHandler, { cookie: alice })).json.saves[0].id;

  const attempt = await call(savesHandler, { method: 'DELETE', cookie: bob, body: { id } });
  assert.equal(attempt.status, 404);

  const still = await call(savesHandler, { cookie: alice });
  assert.equal(still.json.saves.length, 1, 'поиск Алисы пропал после чужого удаления');
});

test('чужой поиск нельзя переключить и переименовать', async () => {
  const id = (await call(savesHandler, { cookie: alice })).json.saves[0].id;
  const attempt = await call(savesHandler, {
    method: 'POST',
    cookie: bob,
    body: { id, notify: false, name: 'захвачено' }
  });
  assert.equal(attempt.status, 404);

  const mine = await call(savesHandler, { cookie: alice });
  assert.equal(mine.json.saves[0].notify, true);
  assert.notEqual(mine.json.saves[0].name, 'захвачено');
});

test('id пользователя в теле запроса игнорируется', async () => {
  // Борис пытается записать избранное «от имени» Алисы всеми способами,
  // какие приходят в голову.
  await call(favsHandler, {
    method: 'POST',
    cookie: bob,
    body: { groupId: 'g001', uid: '700001', user_id: '700001', userId: 700001 }
  });

  const hers = await call(favsHandler, { cookie: alice });
  assert.deepEqual(hers.json.ids, [], 'запись ушла не тому пользователю');

  const his = await call(favsHandler, { cookie: bob });
  assert.deepEqual(his.json.ids, ['g001']);
});

test('битая и чужая кука не дают доступа', async () => {
  assert.equal((await call(savesHandler, { cookie: 'ps_session=подделка' })).status, 401);
  assert.equal((await call(savesHandler, { cookie: 'ps_session=' })).status, 401);
  assert.equal((await call(savesHandler, { cookie: 'другая=кука' })).status, 401);
});

test('мутации с чужого источника отклоняются', async () => {
  const res = await call(savesHandler, {
    method: 'POST',
    cookie: alice,
    origin: 'https://evil.example',
    body: { search: '?kids=9' }
  });
  assert.equal(res.status, 403);
});

test('пустой поиск сохранить нельзя', async () => {
  const res = await call(savesHandler, { method: 'POST', cookie: alice, body: { search: '?' } });
  assert.equal(res.status, 400);
});

test('один и тот же поиск не сохраняется дважды', async () => {
  const res = await call(savesHandler, {
    method: 'POST',
    cookie: alice,
    body: { search: '?win=12345:1080-1320&kids=8' } // те же фильтры, другой порядок
  });
  assert.equal(res.status, 409);
});

test('кабинет отдаёт число подходящих групп, а не сохранённое', async () => {
  const me = await call(meHandler, { cookie: alice });
  assert.equal(me.status, 200);
  const save = me.json.saves[0];
  assert.ok(Number.isInteger(save.count), 'нет счётчика');
  assert.ok(save.count > 0, 'счётчик считается по каталогу при открытии');
  assert.equal(save.name, '8 лет, будни после 18:00');
});

test('сессия ставит httpOnly-куку на 90 дней', async () => {
  const base = { id: 700003, first_name: 'Вера', auth_date: Math.floor(Date.now() / 1000) };
  const res = await call(authHandler, { method: 'POST', body: { ...base, hash: sign(base) } });
  const cookie = res.headers['set-cookie'];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=7776000/);
});
