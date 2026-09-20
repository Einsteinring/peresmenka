// Избранные группы: отслеживание цены и набора.
//
// В хранилище лежит id группы и снимок цены с датой набора на момент
// добавления. Всё остальное берётся из каталога при каждом чтении — хранить
// копию карточки значит однажды показать устаревшую.

import { bad, handler, json, methodIs, notFound, ok, originAllowed, readBody } from './_lib/http.mjs';
import { keyOf, requireUser } from './_lib/session.mjs';
import { readItems, updateItems } from './_lib/redis.mjs';
import { getIndex } from './_lib/catalog.mjs';
import { decorateFavs } from './_lib/account.mjs';

const LIMIT = 50;

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const key = keyOf(user.uid, 'favs');
  const index = getIndex();

  if (methodIs(req, 'GET')) {
    const items = await readItems(key);
    return ok(res, { favs: decorateFavs(items, index), ids: items.map((f) => f.group_id) });
  }

  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });

  if (methodIs(req, 'POST')) {
    const { groupId } = await readBody(req);
    const group = index.byId.get(groupId);
    if (!group) return bad(res, 'Такой группы нет');

    let added = false;
    const items = await updateItems(key, (list) => {
      if (list.some((f) => f.group_id === groupId)) return undefined;
      if (list.length >= LIMIT) throw Object.assign(new Error(`Больше ${LIMIT} групп не отслеживаем`), { status: 400 });
      added = true;
      return [
        {
          group_id: groupId,
          added_at: new Date().toISOString(),
          snapshot: { price_month: group.priceMonth, intake_start: group.intakeStart }
        },
        ...list
      ];
    });
    return ok(res, { added, favs: decorateFavs(items, index), ids: items.map((f) => f.group_id) });
  }

  if (methodIs(req, 'DELETE')) {
    const { groupId } = await readBody(req);
    let found = false;
    const items = await updateItems(key, (list) => {
      const next = list.filter((f) => f.group_id !== groupId);
      found = next.length !== list.length;
      return found ? next : undefined;
    });
    if (!found) return notFound(res);
    return ok(res, { favs: decorateFavs(items, index), ids: items.map((f) => f.group_id) });
  }

  json(res, 405, { error: 'Метод не поддержан' });
});
