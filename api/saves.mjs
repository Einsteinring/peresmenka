// Сохранённые поиски: список, добавление, удаление, переключатель уведомлений.
//
// Владение обеспечено устройством ключа, а не проверкой в коде: человек может
// прочитать и изменить только u:<свой uid>:saves. Чужой id в теле запроса
// подставить некуда — поля пользователя в теле нет.

import { bad, handler, json, methodIs, notFound, ok, originAllowed, readBody } from './_lib/http.mjs';
import { keyOf, requireUser } from './_lib/session.mjs';
import { readItems, updateItems } from './_lib/redis.mjs';
import { getIndex } from './_lib/catalog.mjs';
import { decorateSaves } from './_lib/account.mjs';
import { parseQuery, queryToSearch } from '../js/state.js';
import { describeQuery } from '../js/describe.js';
import { search } from '../js/model.js';
import { randomUUID } from 'node:crypto';

const LIMIT = 20;

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const key = keyOf(user.uid, 'saves');
  const index = getIndex();

  if (methodIs(req, 'GET')) {
    return ok(res, { saves: decorateSaves(await readItems(key), index) });
  }

  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });

  if (methodIs(req, 'POST')) {
    const body = await readBody(req);

    if (body.id) {
      // Переключатель уведомлений и переименование.
      let found = false;
      const items = await updateItems(key, (list) =>
        list.map((s) => {
          if (s.id !== body.id) return s;
          found = true;
          return {
            ...s,
            notify: typeof body.notify === 'boolean' ? body.notify : s.notify,
            name: typeof body.name === 'string' ? body.name.trim().slice(0, 80) || null : s.name
          };
        })
      );
      if (!found) return notFound(res);
      return ok(res, { saves: decorateSaves(items, index) });
    }

    // Запрос приходит той же строкой, что стоит в адресе поиска: второго
    // формата сериализации в проекте нет, и ссылка «Открыть» — это она же.
    const raw = typeof body.search === 'string' ? body.search : '';
    const q = parseQuery(raw);
    const normalized = queryToSearch(q);
    if (!normalized) return bad(res, 'Пустой поиск сохранять нечего');

    const existing = await readItems(key);
    if (existing.some((s) => s.search === normalized)) {
      return json(res, 409, { error: 'Такой поиск уже сохранён' });
    }
    if (existing.length >= LIMIT) return bad(res, `Больше ${LIMIT} поисков не храним`);

    // Список подходящих id запоминаем сразу: «новая группа» — это та,
    // которой здесь не было, а не просто любая из выдачи.
    const seen = search(index, q).items.map((it) => it.group.id);

    const items = await updateItems(key, (list) => [
      {
        id: randomUUID(),
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : describeQuery(q, index),
        search: normalized,
        notify: body.notify !== false,
        created_at: new Date().toISOString(),
        seen_ids: seen,
        checked_at: new Date().toISOString()
      },
      ...list
    ]);
    return ok(res, { saves: decorateSaves(items, index) });
  }

  if (methodIs(req, 'DELETE')) {
    const body = await readBody(req);
    let found = false;
    const items = await updateItems(key, (list) => {
      const next = list.filter((s) => s.id !== body.id);
      found = next.length !== list.length;
      return found ? next : undefined;
    });
    if (!found) return notFound(res);
    return ok(res, { saves: decorateSaves(items, index) });
  }

  json(res, 405, { error: 'Метод не поддержан' });
});
