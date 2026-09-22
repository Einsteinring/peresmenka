// Telegram: проверка подписи виджета входа и отправка сообщений.
//
// Проверка подписи — единственное место во всём проекте, где ошибка означает
// чужой вход, поэтому она написана буквально по документации и покрыта
// тестами: правильный hash проходит, подделка любого поля не проходит,
// протухший auth_date не проходит.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const DAY = 86400;

// Поля, которые Telegram кладёт в виджет. Всё остальное в подпись не входит
// и в профиль не попадает.
const FIELDS = ['auth_date', 'first_name', 'id', 'last_name', 'photo_url', 'username'];

export function checkLogin(data, botToken, now = Math.floor(Date.now() / 1000)) {
  if (!botToken) return { ok: false, reason: 'нет BOT_TOKEN' };
  if (!data || typeof data !== 'object') return { ok: false, reason: 'нет данных' };

  const hash = data.hash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) {
    return { ok: false, reason: 'нет подписи' };
  }

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'нет auth_date' };

  // Строка проверки: все пришедшие поля кроме hash, отсортированы по ключу,
  // склеены переводом строки.
  const checkString = Object.keys(data)
    .filter((k) => k !== 'hash' && data[k] !== undefined && data[k] !== null && data[k] !== '')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');

  const secret = createHash('sha256').update(botToken).digest();
  const mine = createHmac('sha256', secret).update(checkString).digest('hex');

  const a = Buffer.from(mine, 'hex');
  const b = Buffer.from(hash.toLowerCase(), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'подпись не сходится' };

  // Порядок важен: сначала подпись, потом срок. Иначе по времени ответа можно
  // отличить «подпись верна, но протухло» от «подпись не та».
  if (now - authDate > DAY) return { ok: false, reason: 'вход просрочен' };
  if (authDate - now > 300) return { ok: false, reason: 'auth_date из будущего' };

  const id = Number(data.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'нет id' };

  const profile = { id };
  for (const f of FIELDS) {
    if (f === 'id' || f === 'auth_date') continue;
    if (typeof data[f] === 'string' && data[f]) profile[f] = String(data[f]).slice(0, 120);
  }
  return { ok: true, profile };
}

/* ── вызовы Bot API ──────────────────────────────────────────────────────── */

// Один транспорт на все методы. Сеть сюда приходит чужая и ненадёжная,
// поэтому исключение fetch тоже становится обычным { ok: false }: канал
// уведомлений не должен ронять обработчик, который его вызвал.
export async function callApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, status: 0, reason: 'нет BOT_TOKEN' };

  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    return { ok: false, status: 0, reason: String(err?.message || err) };
  }

  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) return { ok: true, result: body.result };
  return { ok: false, status: res.status || 0, reason: body.description || `HTTP ${res.status}` };
}

// Возвращает { ok } либо { ok: false, blocked: true }, если человек не нажимал
// Start и не дал боту право писать. Это не ошибка сервера: канал просто
// недоступен, и кабинет должен сказать об этом словами.
export async function sendMessage(chatId, text, extra = {}) {
  const r = await callApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
  if (r.ok) return { ok: true, result: r.result };
  if (r.status === 403 || r.status === 400) return { ok: false, blocked: true, status: r.status };
  return { ok: false, status: r.status };
}

/* ── секрет вебхука ──────────────────────────────────────────────────────── */

// Telegram присылает заголовок, который мы сами задали при регистрации
// вебхука. Это единственное, что отличает настоящее обновление от чужого
// POST на открытый адрес, поэтому сверка — постоянная по времени, а пустой
// секрет означает «закрыто», а не «пускать всех».
export function webhookSecretOk(req, secret = process.env.TELEGRAM_WEBHOOK_SECRET) {
  if (!secret) return false;
  const got = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof got !== 'string') return false;
  const a = Buffer.from(got, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
