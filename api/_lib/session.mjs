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

export async function startSession(res, uid) {
  const token = randomBytes(24).toString('base64url');
  await command('SET', `sess:${token}`, String(uid), 'EX', TTL);
  const secure = (process.env.SITE_ORIGIN || '').startsWith('https://') ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${TTL}`
  );
  return token;
}

export async function endSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await del(`sess:${token}`);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
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
