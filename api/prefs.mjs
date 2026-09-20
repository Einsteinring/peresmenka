// Каналы доставки и тихие часы.

import { handler, json, methodIs, ok, originAllowed, readBody } from './_lib/http.mjs';
import { requireUser } from './_lib/session.mjs';
import { getPrefs, savePrefs } from './_lib/notify.mjs';

const minutes = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < 1440 && n % 30 === 0 ? n : fallback;
};

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (methodIs(req, 'GET')) return ok(res, { prefs: await getPrefs(user.uid) });

  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });

  if (methodIs(req, 'POST')) {
    const body = await readBody(req);
    const cur = await getPrefs(user.uid);
    const next = {
      ...cur,
      channels: {
        web: body.channels?.web !== undefined ? Boolean(body.channels.web) : cur.channels.web,
        telegram: body.channels?.telegram !== undefined ? Boolean(body.channels.telegram) : cur.channels.telegram
      },
      quiet: {
        from: minutes(body.quiet?.from, cur.quiet.from),
        to: minutes(body.quiet?.to, cur.quiet.to)
      }
    };
    await savePrefs(user.uid, next);
    return ok(res, { prefs: next });
  }

  json(res, 405, { error: 'Метод не поддержан' });
});
