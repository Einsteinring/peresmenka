// Клиент кабинета: один интерфейс поверх двух источников.
//
// Живой режим ходит в /api, демо-режим читает заготовку и меняет её в памяти
// вкладки. Страница кабинета не знает, откуда данные, и поэтому не обрастает
// ветками «если демо».

export const isDemo = () => new URLSearchParams(location.search).get('demo') === '1';

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
    state = await req('/api/me');
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
    saveSearch: async (search, name) => patch(await req('/api/saves', 'POST', { search, name })),
    updateSave: async (id, fields) => patch(await req('/api/saves', 'POST', { id, ...fields })),
    removeSave: async (id) => patch(await req('/api/saves', 'DELETE', { id })),
    addFav: async (groupId) => patch(await req('/api/favs', 'POST', { groupId })),
    removeFav: async (groupId) => patch(await req('/api/favs', 'DELETE', { groupId })),
    setLeadStatus: async (id, status) => patch(await req('/api/leads', 'POST', { id, status })),
    markRead: async (id) => patch(await req('/api/notes', 'POST', id === 'all' ? { all: true } : { id })),
    setPrefs: async (prefs) => patch(await req('/api/prefs', 'POST', prefs)),
    logout: async () => {
      await req('/api/auth/logout', 'POST');
      state = { user: null };
      return state;
    }
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
      const res = await fetch('/data/demo-account.json', { cache: 'no-store' });
      state = await res.json();
      return state;
    },
    async saveSearch() {
      throw new Error('В демо-режиме поиски не сохраняются');
    },
    async updateSave(id, fields) {
      state.saves = state.saves.map((s) => (s.id === id ? { ...s, ...fields } : s));
      return state;
    },
    async removeSave(id) {
      state.saves = state.saves.filter((s) => s.id !== id);
      return state;
    },
    async addFav() {
      throw new Error('В демо-режиме избранное не меняется');
    },
    async removeFav(groupId) {
      state.favs = state.favs.filter((f) => f.id !== groupId);
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
  // Спрашиваем /api/me, а не /api/favs: гостю он отвечает 200 с user: null,
  // и в консоли не остаётся красного 401 на каждой загрузке страницы.
  const data = await req('/api/me').catch(() => ({ user: null }));
  if (!data.user) return null;
  return new Set((data.favs || []).map((f) => f.id));
}

export const toggleFav = (groupId, on) => req('/api/favs', on ? 'POST' : 'DELETE', { groupId });
export const saveCurrentSearch = (search) => req('/api/saves', 'POST', { search });
export const me = () => req('/api/me');
