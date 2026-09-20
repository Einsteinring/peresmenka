// Уведомления: создание, каналы и тихие часы.
//
// Событий ровно шесть, и каждое агрегатор умеет вычислить по своим данным.
// Того, чего он не знает — посещаемости, оплаты, числа свободных мест, —
// здесь нет и быть не может: вместимость группы в каталоге есть, а сколько
// в неё уже записались, центры никому не сообщают.

import { randomUUID } from 'node:crypto';
import { getJson, setJson, updateItems } from './redis.mjs';
import { keyOf } from './session.mjs';
import { sendMessage } from './telegram.mjs';

const KEEP = 60;

export const DEFAULT_PREFS = {
  channels: { web: true, telegram: true },
  quiet: { from: 22 * 60, to: 8 * 60 },
  tg_ok: true
};

export async function getPrefs(uid) {
  const saved = await getJson(keyOf(uid, 'prefs'));
  return {
    ...DEFAULT_PREFS,
    ...(saved || {}),
    channels: { ...DEFAULT_PREFS.channels, ...(saved?.channels || {}) },
    quiet: { ...DEFAULT_PREFS.quiet, ...(saved?.quiet || {}) }
  };
}

export const savePrefs = (uid, prefs) => setJson(keyOf(uid, 'prefs'), prefs);

/* ── тихие часы ──────────────────────────────────────────────────────────── */

// Минуты от полуночи по петербургскому времени. Сервер живёт в UTC,
// поэтому спрашиваем зону явно, а не считаем смещение руками.
export function minutesInPiter(at = new Date()) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

export function inQuietHours(quiet, at = new Date()) {
  const now = minutesInPiter(at);
  const { from, to } = quiet;
  return from > to ? now >= from || now < to : now >= from && now < to;
}

// Когда отправлять, если сейчас нельзя: ближайшее наступление конца тишины.
export function sendAfter(quiet, at = new Date()) {
  if (!inQuietHours(quiet, at)) return null;
  const now = minutesInPiter(at);
  const wait = now < quiet.to ? quiet.to - now : 24 * 60 - now + quiet.to;
  return new Date(at.getTime() + wait * 60000).toISOString();
}

/* ── тексты ──────────────────────────────────────────────────────────────── */

// Один текст на оба канала: в интерфейсе и в сообщении человек читает одно
// и то же, разница только в разметке.
export const KINDS = {
  new_match: {
    title: (d) => `Новая группа по поиску «${d.saveName}»`,
    body: (d) => `${d.groupTitle}, ${d.org}. ${d.address}, ${d.station}. ${d.price} в месяц.`
  },
  trial_tomorrow: {
    title: () => 'Завтра пробное занятие',
    body: (d) => `${d.groupTitle} — ${d.when}, ${d.address}. Взять: ${d.brings}.`
  },
  lead_reply: {
    title: (d) => `Центр ответил на заявку: ${d.groupTitle}`,
    body: (d) => `${d.org} подтверждает пробное ${d.when}. Адрес: ${d.address}.`
  },
  price_changed: {
    title: (d) => `Цена изменилась: ${d.groupTitle}`,
    body: (d) => `Было ${d.was}, стало ${d.now} в месяц.`
  },
  intake_closing: {
    title: (d) => `Набор закрывается: ${d.groupTitle}`,
    body: (d) => `Занятия начинаются ${d.when}, это через ${d.days}.`
  },
  org_new_intake: {
    title: (d) => `Новый набор в центре «${d.org}»`,
    body: (d) => `${d.groupTitle}, ${d.ages}. Вы отслеживаете здесь другую группу.`
  }
};

export function renderNote(kind, data) {
  const shape = KINDS[kind];
  if (!shape) throw new Error(`неизвестное событие: ${kind}`);
  return { title: shape.title(data), body: shape.body(data) };
}

/* ── создание ────────────────────────────────────────────────────────────── */

export async function notify(uid, kind, data, { url = '/lk/', dirId = null, dedupe = null } = {}) {
  const prefs = await getPrefs(uid);
  const { title, body } = renderNote(kind, data);
  const now = new Date();

  let created = null;
  await updateItems(keyOf(uid, 'notes'), (items) => {
    // Один и тот же повод не приходит дважды: например, «набор закрывается»
    // по одной группе каждый день, пока крон крутится.
    if (dedupe && items.some((n) => n.dedupe === dedupe)) return undefined;
    created = {
      id: randomUUID(),
      kind,
      title,
      body,
      url,
      dir: dirId,
      dedupe,
      created_at: now.toISOString(),
      read_at: null
    };
    return [created, ...items].slice(0, KEEP);
  });

  if (!created) return { created: false };

  if (prefs.channels.telegram && prefs.tg_ok) {
    const after = sendAfter(prefs.quiet, now);
    if (after) {
      await updateItems(keyOf(uid, 'outbox'), (items) => [
        ...items,
        { id: created.id, uid, text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`, send_after: after }
      ]);
    } else {
      const sent = await sendMessage(uid, `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`);
      if (sent.blocked) await savePrefs(uid, { ...prefs, tg_ok: false });
    }
  }

  return { created: true, note: created };
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export const unreadCount = (notes) => notes.filter((n) => !n.read_at).length;
