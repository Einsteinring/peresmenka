// Обогащение кабинета данными каталога: считается при каждом чтении,
// в хранилище лежит только то, что каталогом не восстанавливается.

import { search } from '../../js/model.js';
import { parseQuery } from '../../js/state.js';
import { describeQuery } from '../../js/describe.js';
import { dateShort, distance, span, DAY_SHORT } from '../../js/format.js';
import { keyOf } from './session.mjs';
import { updateItems } from './redis.mjs';
import { notify } from './notify.mjs';

export const LEAD_STAGES = ['sent', 'replied', 'visited', 'cancelled'];
export const STAGE_NAMES = {
  sent: 'заявка отправлена',
  replied: 'центр ответил',
  visited: 'посещено',
  cancelled: 'отменена'
};

const groupView = (g) => ({
  id: g.id,
  url: `/g/${g.id}-${g.slug}/`,
  direction: g.direction,
  dirShort: g.dir.short,
  title: g.title,
  org: g.org.name,
  address: g.branch.address,
  station: g.branch.stationName,
  metroDistance: distance(g.branch.metroDistance),
  ages: `${g.ageFrom}—${g.ageTo}`,
  priceMonth: g.priceMonth,
  priceSingle: g.priceSingle,
  schedule: g.lessons.map((l) => `${DAY_SHORT[l.day]} ${span(l.start, l.end)}`).join(', '),
  brings: g.brings.join(', '),
  intakeStart: g.intakeStart
});

/* ── сохранённые поиски ──────────────────────────────────────────────────── */

export function decorateSaves(saves, index) {
  return saves.map((s) => {
    const q = parseQuery(s.search);
    const res = search(index, q);
    return {
      id: s.id,
      name: s.name || describeQuery(q, index),
      search: s.search,
      notify: s.notify !== false,
      created_at: s.created_at,
      count: res.total,
      sample: res.items.slice(0, 3).map((it) => groupView(it.group))
    };
  });
}

/* ── избранное ───────────────────────────────────────────────────────────── */

export function decorateFavs(favs, index) {
  return favs
    .map((f) => {
      const g = index.byId.get(f.group_id);
      if (!g) return null;
      const wasPrice = f.snapshot?.price_month;
      return {
        ...groupView(g),
        added_at: f.added_at,
        // Числа, а не подписи: форматирует клиент тем же format.js, поэтому
        // «4 800 ₽» в кабинете и в выдаче не могут разойтись.
        priceWas: wasPrice && wasPrice !== g.priceMonth ? wasPrice : null,
        priceDown: wasPrice ? g.priceMonth < wasPrice : false
      };
    })
    .filter(Boolean);
}

/* ── заявки ──────────────────────────────────────────────────────────────── */

export function decorateLeads(leads, index) {
  return leads
    .map((l) => {
      const g = index.byId.get(l.group_id);
      if (!g) return null;
      return {
        id: l.id,
        status: l.status,
        statusName: STAGE_NAMES[l.status] || l.status,
        history: l.history || [],
        child: l.child,
        childAge: l.child_age,
        callTime: l.call_time,
        trialAt: l.trial_at,
        group: groupView(g)
      };
    })
    .filter(Boolean);
}

// Первая стадия приходит через минуту после отправки — чтобы было видно,
// что механика живая. Дальше стадии переключает человек: настоящих центров
// за этим демо нет, и делать вид, что они отвечают сами, нечестно.
export async function advanceLeads(uid, leads, index) {
  const now = Date.now();
  const ripe = leads.filter((l) => l.status === 'sent' && l.reply_at && Date.parse(l.reply_at) <= now);
  if (!ripe.length) return leads;

  const updated = await updateItems(keyOf(uid, 'leads'), (items) =>
    items.map((l) =>
      ripe.some((r) => r.id === l.id)
        ? { ...l, status: 'replied', history: [...(l.history || []), { status: 'replied', at: new Date().toISOString() }] }
        : l
    )
  );

  for (const lead of ripe) {
    const g = index.byId.get(lead.group_id);
    if (!g) continue;
    const trial = lead.trial_at ? new Date(lead.trial_at) : null;
    await notify(
      uid,
      'lead_reply',
      {
        groupTitle: `${g.dir.short}: ${g.title}`,
        org: g.org.name,
        address: g.branch.address,
        when: trial ? `${dateShort(lead.trial_at.slice(0, 10))}, ${String(trial.getHours()).padStart(2, '0')}:${String(trial.getMinutes()).padStart(2, '0')}` : 'в ближайшие дни'
      },
      { url: '/lk/?tab=leads', dirId: g.direction, dedupe: `reply:${lead.id}` }
    );
  }

  return updated;
}
