// Клиент кабинета: один интерфейс поверх двух источников.
//
// Живой режим ходит в /api, демо-режим читает заготовку и меняет её в памяти
// вкладки. Страница кабинета не знает, откуда данные, и поэтому не обрастает
// ветками «если демо».

import { DAY_SHORT, distance, span } from './format.js';

export const isDemo = () => new URLSearchParams(location.search).get('demo') === '1';

// Слэш на конце обязателен. В vercel.json включён trailingSlash, и адрес
// без него получает 308 на адрес со слэшем — то есть каждый запрос кабинета
// шёл бы в два захода. Локальный сервер понимает обе формы.
async function req(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Не получилось'), { status: res.status });
  return data;
}

/* ── живой кабинет ───────────────────────────────────────────────────────── */

function liveAccount() {
  let state = null;
  const refresh = async () => {
    state = await req('/api/me/');
    return state;
  };
  const patch = (part) => {
    state = { ...state, ...part };
    return state;
  };

  return {
    demo: false,
    get state() {
      return state;
    },
    load: refresh,
    saveSearch: async (search, name) => patch(await req('/api/saves/', 'POST', { search, name })),
    updateSave: async (id, fields) => patch(await req('/api/saves/', 'POST', { id, ...fields })),
    removeSave: async (id) => patch(await req('/api/saves/', 'DELETE', { id })),
    addFav: async (groupId) => patch(await req('/api/favs/', 'POST', { groupId })),
    removeFav: async (groupId) => patch(await req('/api/favs/', 'DELETE', { groupId })),
    setLeadStatus: async (id, status) => patch(await req('/api/leads/', 'POST', { id, status })),
    markRead: async (id) => patch(await req('/api/notes/', 'POST', id === 'all' ? { all: true } : { id })),
    setPrefs: async (prefs) => patch(await req('/api/prefs/', 'POST', prefs)),
    logout: async () => {
      await req('/api/auth/logout/', 'POST');
      state = { user: null };
      return state;
    }
  };
}

/* ── демо: изменения в пределах вкладки ──────────────────────────────────── */

// Заказчик открывает демо из портфолио и видит в шапке вошедшего Ивана.
// Раньше при этом «Сохранить поиск» и сердце на карточке шли в живой API
// и просили войти — вошедшему. Теперь в демо они работают на заготовке,
// а изменения живут в sessionStorage до закрытия вкладки: сохранённый на
// главной поиск видно и в /lk/?demo=1. На сервер не уходит ничего.
const DEMO_KEY = 'peresmenka:demo';

function readDemo() {
  try {
    const x = JSON.parse(sessionStorage.getItem(DEMO_KEY) || 'null');
    if (x && typeof x === 'object') return { saves: [], favs: [], dropSaves: [], dropFavs: [], ...x };
  } catch {}
  return { saves: [], favs: [], dropSaves: [], dropFavs: [] };
}

function writeDemo(x) {
  try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(x)); } catch {}
}

let demoBase = null;
const demoSeed = async () => {
  if (!demoBase) demoBase = await fetch('/data/demo-account.json', { cache: 'no-store' }).then((r) => r.json());
  return demoBase;
};

// Заготовка плюс то, что человек сделал в этой вкладке.
async function demoState() {
  const base = structuredClone(await demoSeed());
  const x = readDemo();
  const favIdsExtra = new Set(x.favs.map((f) => f.id));
  base.saves = [...x.saves, ...base.saves].filter((s) => !x.dropSaves.includes(s.id));
  base.favs = [...x.favs, ...base.favs.filter((f) => !favIdsExtra.has(f.id))].filter((f) => !x.dropFavs.includes(f.id));
  return base;
}

// Карточка группы для кабинета — та же форма, что отдаёт groupView
// в api/_lib/account.mjs, иначе демо-избранное рисовалось бы иначе живого.
export function favView(g) {
  return {
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
    intakeStart: g.intakeStart,
    priceWas: null,
    priceDown: false
  };
}

/* ── демо-кабинет ────────────────────────────────────────────────────────── */

// Ничего не сохраняется: перезагрузка возвращает заготовку. Так и подписано
// на плашке, чтобы заказчик не решил, что его правки куда-то ушли.
function demoAccount() {
  let state = null;
  const unread = () => state.notes.filter((n) => !n.read_at).length;

  return {
    demo: true,
    get state() {
      return state;
    },
    async load() {
      state = await demoState();
      return state;
    },
    async saveSearch() {
      throw new Error('В демо-режиме поиск сохраняется со страницы поиска');
    },
    async updateSave(id, fields) {
      state.saves = state.saves.map((s) => (s.id === id ? { ...s, ...fields } : s));
      return state;
    },
    async removeSave(id) {
      state.saves = state.saves.filter((s) => s.id !== id);
      const x = readDemo();
      writeDemo({ ...x, dropSaves: [...x.dropSaves, id] });
      return state;
    },
    async addFav() {
      throw new Error('В демо-режиме избранное не меняется');
    },
    async removeFav(groupId) {
      state.favs = state.favs.filter((f) => f.id !== groupId);
      const x = readDemo();
      writeDemo({ ...x, favs: x.favs.filter((f) => f.id !== groupId), dropFavs: [...x.dropFavs, groupId] });
      return state;
    },
    async setLeadStatus(id, status) {
      const at = new Date().toISOString();
      state.leads = state.leads.map((l) =>
        l.id === id ? { ...l, status, history: [...l.history, { status, at }] } : l
      );
      return state;
    },
    async markRead(id) {
      const at = new Date().toISOString();
      state.notes = state.notes.map((n) =>
        n.read_at || (id !== 'all' && n.id !== id) ? n : { ...n, read_at: at }
      );
      state.unread = unread();
      return state;
    },
    async setPrefs(prefs) {
      state.prefs = { ...state.prefs, ...prefs };
      return state;
    },
    async logout() {
      location.href = '/lk/';
      return state;
    }
  };
}

export const createAccount = () => (isDemo() ? demoAccount() : liveAccount());

/* ── избранное на страницах поиска и группы ──────────────────────────────── */

// Отдельный лёгкий путь: там не нужен весь кабинет, нужен только список id
// и возможность его менять. Гостю отдаётся пустой список без ошибки.
export async function favIds() {
  if (isDemo()) return new Set((await demoState()).favs.map((f) => f.id));
  // Спрашиваем /api/me, а не /api/favs: гостю он отвечает 200 с user: null,
  // и в консоли не остаётся красного 401 на каждой загрузке страницы.
  const data = await req('/api/me/').catch(() => ({ user: null }));
  if (!data.user) return null;
  return new Set((data.favs || []).map((f) => f.id));
}

// view — карточка группы для кабинета; нужна только демо-режиму, живой
// сервер соберёт её сам по id.
export async function toggleFav(groupId, on, view) {
  if (!isDemo()) return req('/api/favs/', on ? 'POST' : 'DELETE', { groupId });
  const x = readDemo();
  const favs = x.favs.filter((f) => f.id !== groupId);
  writeDemo({
    ...x,
    favs: on && view ? [view, ...favs] : favs,
    dropFavs: on ? x.dropFavs.filter((id) => id !== groupId) : [...x.dropFavs, groupId]
  });
  return { demo: true };
}

// meta — имя и число групп для демо-кабинета; живой сервер считает их сам.
export async function saveCurrentSearch(search, meta = {}) {
  if (!isDemo()) return req('/api/saves/', 'POST', { search });
  const x = readDemo();
  if (x.saves.some((s) => s.search === search)) return { demo: true, duplicate: true };
  const save = {
    id: `demo-${Date.now()}`,
    name: meta.name || 'Сохранённый поиск',
    search,
    notify: true,
    created_at: new Date().toISOString(),
    count: meta.count ?? 0
  };
  writeDemo({ ...x, saves: [save, ...x.saves] });
  return { demo: true, save };
}
export const me = () => req('/api/me/');
