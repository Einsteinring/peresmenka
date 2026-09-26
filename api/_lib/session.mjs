// Сессия: httpOnly-кука на 90 дней и получение пользователя из неё.
//
// Правило, которое не нарушается ни в одном обработчике: uid берётся только
// отсюда. В теле запроса поля пользователя нет вообще — подсунуть чужой id
// некуда, а не «мы его игнорируем».

import { randomBytes } from 'node:crypto';
import { command, del, getJson, setJsonEx } from './redis.mjs';
import { unauthorized } from './http.mjs';

export const COOKIE = 'ps_session';
const TTL = 90 * 24 * 3600;

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Атрибуты куки — одни на вход и на выход. Браузер гасит куку, только если
// совпали имя, Path и Domain; Secure и SameSite тоже держим одинаковыми,
// чтобы выход не зависел от того, насколько снисходителен браузер.
// Domain не задаётся нигде: кука живёт только на своём хосте.
function cookieAttrs() {
  const secure = (process.env.SITE_ORIGIN || '').startsWith('https://') ? '; Secure' : '';
  return `HttpOnly${secure}; SameSite=Lax; Path=/`;
}

export async function startSession(res, uid) {
  const token = randomBytes(24).toString('base64url');
  await command('SET', `sess:${token}`, String(uid), 'EX', TTL);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs()}; Max-Age=${TTL}`);
  return token;
}

// Выход: сессия удаляется из хранилища — старая кука после этого ничего не
// открывает, даже если браузер её не забыл. Кука гасится с теми же
// атрибутами. Без сессии тоже не ошибка: гасить нечего, ответ тот же.
export async function endSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await del(`sess:${token}`);
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs()}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

export async function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const uid = await command('GET', `sess:${token}`);
  if (!uid) return null;
  const profile = await getJson(`u:${uid}`);
  if (!profile) return null;
  return { uid: String(uid), profile };
}

// Возвращает пользователя либо сам отвечает 401 и возвращает null.
// Обработчик после этого обязан выйти.
export async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    unauthorized(res);
    return null;
  }
  return user;
}

export async function saveProfile(uid, profile) {
  await setJsonEx(`u:${uid}`, { ...profile, updated_at: new Date().toISOString() }, TTL);
}

export const keyOf = (uid, name) => `u:${uid}:${name}`;
