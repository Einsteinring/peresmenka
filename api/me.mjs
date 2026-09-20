// Профиль, настройки и весь кабинет одним ответом.
//
// Гостю отвечаем 200 с { user: null }, а не 401: кабинет для гостя — это
// не ошибка, а нормальное состояние страницы, на которой ему предлагают
// вход и демо-режим.

import { handler, ok } from './_lib/http.mjs';
import { currentUser, keyOf } from './_lib/session.mjs';
import { getPrefs, unreadCount } from './_lib/notify.mjs';
import { readItems, usingMemory } from './_lib/redis.mjs';
import { getIndex } from './_lib/catalog.mjs';
import { advanceLeads, decorateFavs, decorateLeads, decorateSaves } from './_lib/account.mjs';

export default handler(async (req, res) => {
  const user = await currentUser(req);
  const bot = process.env.TELEGRAM_BOT_USERNAME || '';
  // Какое хранилище подключено на самом деле. Без этого поля забытые
  // переменные Upstash выглядят как работающий сайт, на котором просто
  // ничего не сохраняется между запросами.
  const store = usingMemory ? 'memory' : 'upstash';
  if (!user) return ok(res, { user: null, bot, store });

  const { uid } = user;
  const [prefs, saves, favs, leadsRaw, notes] = await Promise.all([
    getPrefs(uid),
    readItems(keyOf(uid, 'saves')),
    readItems(keyOf(uid, 'favs')),
    readItems(keyOf(uid, 'leads')),
    readItems(keyOf(uid, 'notes'))
  ]);

  const index = getIndex();
  // «Центр ответил» приходит через минуту после заявки. Отдельного планировщика
  // для этого нет и не нужно: стадия вычисляется при чтении.
  const leads = await advanceLeads(uid, leadsRaw, index);

  ok(res, {
    user: user.profile,
    bot,
    store,
    prefs,
    unread: unreadCount(notes),
    notes: notes.slice(0, 30),
    // Число «сейчас подходит» считается на открытии кабинета, а не хранится
    // рядом с фильтрами: сохранённое устареет через неделю и будет врать.
    saves: decorateSaves(saves, index),
    favs: decorateFavs(favs, index),
    leads: decorateLeads(leads, index)
  });
});
