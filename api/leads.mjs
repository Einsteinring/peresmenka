// Заявки на пробное.
//
// Отправить заявку может кто угодно, вход для этого не нужен. Если человек
// вошёл, заявка попадает к нему в кабинет и начинает жить по сценарию:
// через минуту приходит «центр ответил», дальше стадии переключаются руками.
// Настоящих центров за этим демо нет, и делать вид, что они отвечают сами,
// было бы враньём — поэтому переключатель подписан как часть демо-режима.

import { bad, handler, json, methodIs, notFound, ok, originAllowed, readBody } from './_lib/http.mjs';
import { currentUser, keyOf, requireUser } from './_lib/session.mjs';
import { readItems, updateItems } from './_lib/redis.mjs';
import { getIndex } from './_lib/catalog.mjs';
import { LEAD_STAGES, STAGE_NAMES, advanceLeads, decorateLeads } from './_lib/account.mjs';
import { randomUUID } from 'node:crypto';

const REPLY_DELAY_MS = 60 * 1000;
const digits = (s) => String(s || '').replace(/\D/g, '');

// Пробное назначаем на ближайшее занятие группы: дату и время берём
// из расписания, а не выдумываем.
function nextLesson(group, from = new Date()) {
  const today = ((from.getDay() + 6) % 7) + 1;
  const sorted = [...group.lessons].sort((a, b) => a.day - b.day || a.start - b.start);
  const pick = sorted.find((l) => l.day > today) || sorted[0];
  const ahead = pick.day > today ? pick.day - today : 7 - today + pick.day;
  const at = new Date(from);
  at.setDate(at.getDate() + ahead);
  at.setHours(Math.floor(pick.start / 60), pick.start % 60, 0, 0);
  return at;
}

export default handler(async (req, res) => {
  const index = getIndex();

  if (methodIs(req, 'GET')) {
    const user = await requireUser(req, res);
    if (!user) return;
    const leads = await advanceLeads(user.uid, await readItems(keyOf(user.uid, 'leads')), index);
    return ok(res, { leads: decorateLeads(leads, index) });
  }

  if (!originAllowed(req)) return json(res, 403, { error: 'Чужой источник' });

  if (methodIs(req, 'POST')) {
    const body = await readBody(req);

    // Смена стадии — только своей заявки, и только на стадию из списка.
    if (body.id && body.status) {
      const user = await requireUser(req, res);
      if (!user) return;
      if (!LEAD_STAGES.includes(body.status)) return bad(res, 'Неизвестная стадия');
      let found = false;
      const items = await updateItems(keyOf(user.uid, 'leads'), (list) =>
        list.map((l) => {
          if (l.id !== body.id) return l;
          found = true;
          return {
            ...l,
            status: body.status,
            reply_at: null,
            history: [...(l.history || []), { status: body.status, at: new Date().toISOString() }]
          };
        })
      );
      if (!found) return notFound(res);
      return ok(res, { leads: decorateLeads(items, index) });
    }

    const group = index.byId.get(body.groupId);
    if (!group) return bad(res, 'Такой группы нет');
    if (!body.parent || String(body.parent).trim().length < 2) return bad(res, 'Как к вам обращаться?');
    if (digits(body.phone).length < 10) return bad(res, 'Нужен телефон из 10 цифр');
    if (!body.child || String(body.child).trim().length < 2) return bad(res, 'Имя ребёнка');
    const age = Number(body.childAge);
    if (!Number.isInteger(age) || age < 2 || age > 18) return bad(res, 'Возраст ребёнка от 2 до 18');

    const trialAt = nextLesson(group);
    const lead = {
      id: randomUUID(),
      group_id: group.id,
      parent: String(body.parent).trim().slice(0, 80),
      phone: String(body.phone).trim().slice(0, 32),
      child: String(body.child).trim().slice(0, 80),
      child_age: age,
      call_time: String(body.callTime || 'в любое время').slice(0, 40),
      trial_at: trialAt.toISOString(),
      status: 'sent',
      reply_at: new Date(Date.now() + REPLY_DELAY_MS).toISOString(),
      history: [{ status: 'sent', at: new Date().toISOString() }],
      created_at: new Date().toISOString()
    };

    // Гость тоже отправляет заявку — она просто никуда не сохраняется.
    const user = await currentUser(req);
    if (!user) {
      return ok(res, { saved: false, trialAt: lead.trial_at, statusName: STAGE_NAMES.sent });
    }

    await updateItems(keyOf(user.uid, 'leads'), (list) => [lead, ...list].slice(0, 40));
    return ok(res, { saved: true, trialAt: lead.trial_at, statusName: STAGE_NAMES.sent });
  }

  json(res, 405, { error: 'Метод не поддержан' });
});
