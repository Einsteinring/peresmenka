// Вход через Telegram Login Widget.
//
// Второй способ — вход по ссылке на бота, он в api/auth/link.mjs. Оба
// заканчиваются одним и тем же: registerUser и обычная сессия.

import { handler, json, methodIs, ok, originAllowed, readBody } from '../_lib/http.mjs';
import { checkLogin } from '../_lib/telegram.mjs';
import { startSession } from '../_lib/session.mjs';
import { registerUser } from '../_lib/account.mjs';

export default handler(async (req, res) => {
  if (!methodIs(req, 'POST')) return json(res, 405, { error: 'Только POST' });
  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });

  const data = await readBody(req);
  const result = checkLogin(data, process.env.TELEGRAM_BOT_TOKEN);
  if (!result.ok) {
    // Причину пишем в лог, наружу — общий текст: подсказывать, какое именно
    // поле не сошлось, тому, кто подбирает подпись, незачем.
    console.warn('telegram login отклонён:', result.reason);
    return json(res, 401, { error: 'Вход не подтвердился. Попробуйте ещё раз.' });
  }

  // Виджет с data-request-access="write" означает, что боту разрешили писать.
  const uid = await registerUser(result.profile, { tgOk: true });
  await startSession(res, uid);

  ok(res, { user: result.profile });
});
