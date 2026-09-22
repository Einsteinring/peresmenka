// Вход по ссылке на бота: сторона сайта.
//
// POST — завести заявку. Возвращает одноразовый код для ссылки, код сверки
//        для глаз и сам адрес t.me.
// GET  — спросить, чем дело кончилось. Как только заявка подтверждена,
//        здесь же выдаётся обычная сессия, та же самая, что у виджета.
//
// Опрос, а не ожидание: держать открытым соединение на серверless-функции —
// значит платить за минуты сна. Две секунды задержки тут никто не заметит.

import { handler, json, methodIs, ok, originAllowed } from '../_lib/http.mjs';
import { createLink, LINK_TTL, takeLink } from '../_lib/link.mjs';
import { startSession } from '../_lib/session.mjs';
import { command } from '../_lib/redis.mjs';

// Заявку заводит кто угодно без входа — иначе входить было бы нечем.
// Значит, её можно штамповать пачками, и хотя каждая весит сотню байт
// и умирает через десять минут, счёт запросов к базе не бесконечный.
// Двадцати попыток за то же окно хватает любому живому человеку.
const PER_WINDOW = 20;

async function tooOften(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
  const key = `linkrate:${ip}`;
  const n = Number(await command('INCR', key));
  if (n === 1) await command('EXPIRE', key, LINK_TTL);
  return n > PER_WINDOW;
}

export default handler(async (req, res) => {
  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });

  const bot = process.env.TELEGRAM_BOT_USERNAME;

  if (methodIs(req, 'POST')) {
    if (!bot) return json(res, 503, { error: 'Вход через Telegram не настроен' });
    if (await tooOften(req)) {
      return json(res, 429, { error: 'Слишком много попыток входа. Попробуйте через десять минут.' });
    }
    const { nonce, code } = await createLink();
    return ok(res, {
      nonce,
      code,
      url: `https://t.me/${bot}?start=${nonce}`,
      expires_in: LINK_TTL
    });
  }

  if (methodIs(req, 'GET')) {
    const nonce = new URL(req.url, 'http://localhost').searchParams.get('nonce');
    const rec = await takeLink(nonce);
    if (rec.status !== 'ok') return ok(res, { status: rec.status });
    await startSession(res, rec.uid);
    return ok(res, { status: 'ok', user: rec.profile });
  }

  return json(res, 405, { error: 'Только POST и GET' });
});
