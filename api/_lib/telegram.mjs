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

/* ── отправка ────────────────────────────────────────────────────────────── */

// Возвращает { ok } либо { ok: false, blocked: true }, если человек не нажимал
// Start и не дал боту право писать. Это не ошибка сервера: канал просто
// недоступен, и кабинет должен сказать об этом словами.
export async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: 'нет BOT_TOKEN' };

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  }).catch((err) => ({ ok: false, status: 0, _err: err }));

  if (res.ok) return { ok: true };
  const status = res.status || 0;
  if (status === 403 || status === 400) return { ok: false, blocked: true, status };
  return { ok: false, status };
}
