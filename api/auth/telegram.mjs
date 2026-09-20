// Вход через Telegram Login Widget.

import { handler, json, methodIs, ok, originAllowed, readBody } from '../_lib/http.mjs';
import { checkLogin } from '../_lib/telegram.mjs';
import { saveProfile, startSession } from '../_lib/session.mjs';
import { getPrefs, savePrefs } from '../_lib/notify.mjs';
import { updateItems } from '../_lib/redis.mjs';

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

  const uid = String(result.profile.id);
  await saveProfile(uid, result.profile);
  // Виджет с data-request-access="write" означает, что боту разрешили писать.
  // Если это первый вход, включаем оба канала.
  const prefs = await getPrefs(uid);
  await savePrefs(uid, { ...prefs, tg_ok: true });
  // Реестр входивших: крону нужно кого-то обходить, а KEYS по базе —
  // плохая привычка, которая однажды упрётся в размер.
  await updateItems('users', (list) => (list.includes(uid) ? undefined : [...list, uid]));
  await startSession(res, uid);

  ok(res, { user: result.profile });
});
