// Вход по ссылке на бота: заявка, код сверки и её состояния.
//
// Зачем это рядом с виджетом. Виджет ведёт на oauth.telegram.org, тот просит
// номер и шлёт подтверждение служебным сообщением — и до российских номеров
// оно доходит через раз. Здесь браузер в опознании не участвует вообще:
// человек открывает бота, нажимает «Запустить», и уже сервер Telegram сам
// стучится к нам и сообщает, кто это. Подделать такое обращение снаружи
// нельзя — оно приходит на адрес, закрытый секретом.
//
// Главная опасность схемы — обратное фишинговое направление: злоумышленник
// открывает вход у себя, подсовывает жертве свою ссылку, та жмёт «Запустить»,
// и сессия достаётся ему. Поэтому заявка подтверждается не нажатием Start,
// а отдельной кнопкой в боте, и рядом с ней показан код, который виден
// только на экране того, кто вход начал. Не совпало — не подтверждать.

import { randomBytes, randomInt } from 'node:crypto';
import { del, getJson, setJsonEx } from './redis.mjs';

export const LINK_TTL = 600; // заявка живёт 10 минут

// Буквы и цифры, которые не путаются глазами: ни нуля с O, ни единицы с I.
const ALPHABET = 'ACDEFHJKLMNPQRTUVWXY34679';

export const linkKey = (nonce) => `link:${nonce}`;

// Payload у /start ограничен 64 знаками из [A-Za-z0-9_-] — base64url как раз.
export const nonceOk = (nonce) => typeof nonce === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(nonce);

export function newCode(length = 4) {
  let out = '';
  // randomInt без остатка от деления: смещения в пользу первых букв нет.
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

export async function createLink() {
  const nonce = randomBytes(18).toString('base64url');
  const code = newCode();
  const rec = { code, status: 'pending', created_at: new Date().toISOString() };
  await setJsonEx(linkKey(nonce), rec, LINK_TTL);
  return { nonce, code };
}

export async function readLink(nonce) {
  if (!nonceOk(nonce)) return null;
  return getJson(linkKey(nonce));
}

export const dropLink = (nonce) => (nonceOk(nonce) ? del(linkKey(nonce)) : null);

// Нажали Start по ссылке: запоминаем, кто именно, и ждём подтверждения.
// Повторный Start по той же заявке ничего не меняет — состояние уже занято,
// и подменить человека на середине пути нельзя.
export async function markAsked(nonce, profile) {
  const rec = await readLink(nonce);
  if (!rec || rec.status !== 'pending') return null;
  const next = { ...rec, status: 'asked', profile, asked_at: new Date().toISOString() };
  await setJsonEx(linkKey(nonce), next, LINK_TTL);
  return next;
}

// Подтверждение кнопкой. Нажать её должен тот же человек, который жал Start:
// id берём из обновления Telegram, а не из данных кнопки.
export async function confirmLink(nonce, fromId) {
  const rec = await readLink(nonce);
  if (!rec || rec.status !== 'asked') return null;
  if (String(rec.profile?.id) !== String(fromId)) return null;
  const next = { ...rec, status: 'ok', uid: String(rec.profile.id), ok_at: new Date().toISOString() };
  await setJsonEx(linkKey(nonce), next, LINK_TTL);
  return next;
}

// Забрать подтверждённую заявку. Ключ удаляется в тот же момент: войти по
// одной заявке дважды нельзя, даже если ссылку успели подсмотреть.
export async function takeLink(nonce) {
  const rec = await readLink(nonce);
  if (!rec) return { status: 'expired' };
  if (rec.status !== 'ok') return { status: rec.status };
  await dropLink(nonce);
  return { status: 'ok', uid: rec.uid, profile: rec.profile };
}

// Профиль из обновления Telegram приводим к тому же виду, что даёт виджет:
// кабинету всё равно, каким путём человек вошёл.
export function profileFrom(from) {
  if (!from || typeof from !== 'object') return null;
  const id = Number(from.id);
  if (!Number.isInteger(id) || id <= 0 || from.is_bot) return null;
  const profile = { id };
  for (const f of ['first_name', 'last_name', 'username']) {
    if (typeof from[f] === 'string' && from[f]) profile[f] = from[f].slice(0, 120);
  }
  return profile;
}
