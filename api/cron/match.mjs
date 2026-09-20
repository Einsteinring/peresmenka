// Сопоставитель: раз в сутки проходит по сохранённым поискам и избранному
// и создаёт уведомления. Плюс дошлёт то, что откладывали на тихие часы.
//
// Здесь и находится главная причина, по которой весь бэкенд на Node:
// подбор считается тем же js/model.js, что и живой поиск. Второй реализации
// правила «занятие целиком внутри окна» в проекте нет и не будет.

import { handler, json, methodIs, ok } from '../_lib/http.mjs';
import { readItems, updateItems } from '../_lib/redis.mjs';
import { keyOf } from '../_lib/session.mjs';
import { getPrefs, notify } from '../_lib/notify.mjs';
import { sendMessage } from '../_lib/telegram.mjs';
import { getIndex } from '../_lib/catalog.mjs';
import { search } from '../../js/model.js';
import { parseQuery } from '../../js/state.js';
import { dateShort, intake, plural, price } from '../../js/format.js';

const CLOSING_DAYS = 7;

export default handler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.authorization === `Bearer ${secret}` || req.headers['x-cron-secret'] === secret;
  if (!secret || !given) return json(res, 401, { error: 'Нужен CRON_SECRET' });
  if (!methodIs(req, 'GET', 'POST')) return json(res, 405, { error: 'Метод не поддержан' });

  const index = getIndex();
  const now = new Date();
  const users = await readItems('users');
  const report = { users: users.length, new_match: 0, trial_tomorrow: 0, price_changed: 0, intake_closing: 0, org_new_intake: 0, sent_from_outbox: 0 };

  for (const uid of users) {
    report.new_match += await checkSaves(uid, index, report);
    await checkFavs(uid, index, now, report);
    await checkTrials(uid, index, now, report);
    report.sent_from_outbox += await flushOutbox(uid, now);
  }

  ok(res, { ok: true, at: now.toISOString(), ...report });
});

/* ── новая группа по сохранённому поиску ─────────────────────────────────── */

async function checkSaves(uid, index, report) {
  const saves = await readItems(keyOf(uid, 'saves'));
  if (!saves.length) return 0;
  let made = 0;

  for (const save of saves) {
    if (save.notify === false) continue;
    const res = search(index, parseQuery(save.search));
    const seen = new Set(save.seen_ids || []);
    const fresh = res.items.filter((it) => !seen.has(it.group.id));
    if (!fresh.length) continue;

    // Сообщаем про первую новую и считаем остальные: шесть уведомлений
    // подряд по одному поиску — это не забота, а шум.
    const g = fresh[0].group;
    const extra = fresh.length - 1;
    await notify(
      uid,
      'new_match',
      {
        saveName: save.name,
        groupTitle: `${g.dir.short}: ${g.title}${extra ? ` и ещё ${extra}` : ''}`,
        org: g.org.name,
        address: g.branch.address,
        station: g.branch.stationName,
        price: price(g.priceMonth)
      },
      { url: `/${save.search}`, dirId: g.direction, dedupe: `match:${save.id}:${g.id}` }
    );
    made++;
  }

  if (made) {
    await updateItems(keyOf(uid, 'saves'), (list) =>
      list.map((s) => {
        if (s.notify === false) return s;
        const ids = search(index, parseQuery(s.search)).items.map((it) => it.group.id);
        return { ...s, seen_ids: ids, checked_at: new Date().toISOString() };
      })
    );
  }
  return made;
}

/* ── цена, закрытие набора, новый набор в знакомом центре ────────────────── */

async function checkFavs(uid, index, now, report) {
  const favs = await readItems(keyOf(uid, 'favs'));
  if (!favs.length) return;

  const watchedOrgs = new Set();
  const watchedIds = new Set(favs.map((f) => f.group_id));

  for (const fav of favs) {
    const g = index.byId.get(fav.group_id);
    if (!g) continue;
    watchedOrgs.add(g.orgId);

    const was = fav.snapshot?.price_month;
    if (was && was !== g.priceMonth) {
      await notify(
        uid,
        'price_changed',
        { groupTitle: `${g.dir.short}: ${g.title}`, was: price(was), now: price(g.priceMonth) },
        { url: `/g/${g.id}-${g.slug}/`, dirId: g.direction, dedupe: `price:${g.id}:${g.priceMonth}` }
      );
      report.price_changed++;
    }

    const start = intake(g.intakeStart, now);
    if (start.days > 0 && start.days <= CLOSING_DAYS) {
      await notify(
        uid,
        'intake_closing',
        {
          groupTitle: `${g.dir.short}: ${g.title}`,
          when: dateShort(g.intakeStart),
          days: `${start.days} ${plural(start.days, 'день', 'дня', 'дней')}`
        },
        { url: `/g/${g.id}-${g.slug}/`, dirId: g.direction, dedupe: `closing:${g.id}:${g.intakeStart}` }
      );
      report.intake_closing++;
    }
  }

  // Отдельной подписки на центр нет: «знакомый центр» — это тот, где человек
  // уже что-то отслеживает. Заводить вторую сущность ради одного события
  // не стоит.
  for (const g of index.groups) {
    if (!watchedOrgs.has(g.orgId) || watchedIds.has(g.id)) continue;
    const start = intake(g.intakeStart, now);
    if (start.days <= 0 || start.days > 30) continue;
    await notify(
      uid,
      'org_new_intake',
      { org: g.org.name, groupTitle: `${g.dir.short}: ${g.title}`, ages: `${g.ageFrom}—${g.ageTo} лет` },
      { url: `/g/${g.id}-${g.slug}/`, dirId: g.direction, dedupe: `orgintake:${g.id}:${g.intakeStart}` }
    );
    report.org_new_intake++;
  }
}

/* ── пробное завтра ──────────────────────────────────────────────────────── */

async function checkTrials(uid, index, now, report) {
  const leads = await readItems(keyOf(uid, 'leads'));
  for (const lead of leads) {
    if (!lead.trial_at || lead.status === 'cancelled' || lead.status === 'visited') continue;
    const at = new Date(lead.trial_at);
    const days = Math.round((at - now) / 86400000);
    if (days !== 1) continue;
    const g = index.byId.get(lead.group_id);
    if (!g) continue;
    await notify(
      uid,
      'trial_tomorrow',
      {
        groupTitle: `${g.dir.short}: ${g.title}`,
        when: `${dateShort(lead.trial_at.slice(0, 10))}, ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
        address: `${g.branch.address} (${g.branch.stationName})`,
        brings: g.brings.join(', ')
      },
      { url: '/lk/?tab=leads', dirId: g.direction, dedupe: `trial:${lead.id}` }
    );
    report.trial_tomorrow++;
  }
}

/* ── отложенное на тихие часы ────────────────────────────────────────────── */

async function flushOutbox(uid, now) {
  const queued = await readItems(keyOf(uid, 'outbox'));
  if (!queued.length) return 0;
  const due = queued.filter((m) => Date.parse(m.send_after) <= now.getTime());
  if (!due.length) return 0;

  const prefs = await getPrefs(uid);
  let sent = 0;
  for (const message of due) {
    if (!prefs.channels.telegram || !prefs.tg_ok) continue;
    const res = await sendMessage(uid, message.text);
    if (res.ok) sent++;
  }
  const doneIds = new Set(due.map((m) => m.id));
  await updateItems(keyOf(uid, 'outbox'), (list) => list.filter((m) => !doneIds.has(m.id)));
  return sent;
}
