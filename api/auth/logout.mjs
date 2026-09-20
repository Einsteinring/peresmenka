// Выход: сессия удаляется из хранилища, кука гасится.

import { handler, json, methodIs, ok, originAllowed } from '../_lib/http.mjs';
import { endSession } from '../_lib/session.mjs';

export default handler(async (req, res) => {
  if (!methodIs(req, 'POST')) return json(res, 405, { error: 'Только POST' });
  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });
  await endSession(req, res);
  ok(res, { user: null });
});
