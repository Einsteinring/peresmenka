// Выход: сессия удаляется из хранилища, кука гасится.
//
// Два клиента. Кнопка «Выйти» в шапке — обычная форма POST без скрипта:
// ей отвечаем 303 на /lk/, где гость видит экран входа. Скрипт (fetch)
// получает JSON, как от остальных функций. От межсайтового POST защищают
// SameSite=Lax у куки и сверка Origin — та же, что на всех изменениях.

import { handler, json, methodIs, ok, originAllowed } from '../_lib/http.mjs';
import { endSession } from '../_lib/session.mjs';

const fromForm = (req) =>
  /application\/x-www-form-urlencoded|multipart\/form-data/i.test(req.headers['content-type'] || '') ||
  /text\/html/i.test(req.headers.accept || '');

export default handler(async (req, res) => {
  if (!methodIs(req, 'POST')) {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Только POST' });
  }
  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });
  await endSession(req, res);
  if (fromForm(req)) {
    res.statusCode = 303;
    res.setHeader('Location', '/lk/');
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
  ok(res, { user: null });
});
