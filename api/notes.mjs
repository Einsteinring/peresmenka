// Уведомления: список и отметка о прочтении.

import { handler, json, methodIs, ok, originAllowed, readBody } from './_lib/http.mjs';
import { keyOf, requireUser } from './_lib/session.mjs';
import { readItems, updateItems } from './_lib/redis.mjs';
import { unreadCount } from './_lib/notify.mjs';

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const key = keyOf(user.uid, 'notes');

  if (methodIs(req, 'GET')) {
    const notes = await readItems(key);
    return ok(res, { notes: notes.slice(0, 30), unread: unreadCount(notes) });
  }

  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });

  if (methodIs(req, 'POST')) {
    const body = await readBody(req);
    const at = new Date().toISOString();
    const notes = await updateItems(key, (list) =>
      list.map((n) => (n.read_at || (!body.all && n.id !== body.id) ? n : { ...n, read_at: at }))
    );
    return ok(res, { notes: notes.slice(0, 30), unread: unreadCount(notes) });
  }

  json(res, 405, { error: 'Метод не поддержан' });
});
