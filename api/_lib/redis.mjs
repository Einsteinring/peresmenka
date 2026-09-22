// Upstash Redis через REST. Зависимостей нет: хватает fetch из Node.
//
// Если переменные окружения не заданы, клиент работает в памяти процесса.
// Это не «тихий фолбэк вместо ошибки», а режим для локального запуска:
// npm run serve поднимает сайт вместе с функциями и без Upstash, а на Vercel
// переменные есть всегда, и в память он не свалится.

const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const usingMemory = !URL_ || !TOKEN;

const memory = new Map();
const expiries = new Map();

function memoryCommand(args) {
  const [rawOp, key, ...rest] = args;
  const op = String(rawOp).toUpperCase();

  const alive = (k) => {
    const until = expiries.get(k);
    if (until && until < Date.now()) {
      memory.delete(k);
      expiries.delete(k);
      return false;
    }
    return memory.has(k);
  };

  switch (op) {
    case 'GET':
      return alive(key) ? memory.get(key) : null;
    case 'SET': {
      memory.set(key, rest[0]);
      const exIndex = rest.findIndex((x) => String(x).toUpperCase() === 'EX');
      if (exIndex !== -1) expiries.set(key, Date.now() + Number(rest[exIndex + 1]) * 1000);
      return 'OK';
    }
    case 'DEL': {
      const had = alive(key);
      memory.delete(key);
      expiries.delete(key);
      return had ? 1 : 0;
    }
    case 'INCR': {
      const next = (alive(key) ? Number(memory.get(key)) : 0) + 1;
      memory.set(key, String(next));
      return next;
    }
    case 'EXPIRE':
      expiries.set(key, Date.now() + Number(rest[0]) * 1000);
      return 1;
    case 'KEYS': {
      const re = new RegExp(`^${String(key).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return [...memory.keys()].filter((k) => alive(k) && re.test(k));
    }
    default:
      throw new Error(`memoryCommand: ${op} не поддержан`);
  }
}

export async function command(...args) {
  if (usingMemory) return memoryCommand(args);
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String))
  });
  if (res.status === 403) {
    // У Upstash два REST-токена, и в консоли они лежат рядом. С токеном
    // «только чтение» сайт выглядит рабочим: каталог открывается, кабинет
    // отвечает, а любая запись падает. Пусть в логе будет сказано прямо.
    throw new Error(`upstash 403 на ${String(args[0]).toUpperCase()}: похоже, взят токен только для чтения`);
  }
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`upstash: ${body.error}`);
  return body.result;
}

export const get = (key) => command('GET', key);
export const del = (key) => command('DEL', key);
export const setJson = (key, value) => command('SET', key, JSON.stringify(value));
export const setJsonEx = (key, value, seconds) => command('SET', key, JSON.stringify(value), 'EX', seconds);

export async function getJson(key, fallback = null) {
  const raw = await get(key);
  if (raw == null) return fallback;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return fallback;
  }
}

/* ── документ с версией и запись «только если не изменилось» ─────────────── */

// Коллекции кабинета лежат целыми массивами: весь кабинет читается четырьмя
// запросами вместо N+1. Плата за это — гонка между двумя вкладками, поэтому
// рядом с массивом живёт номер версии, а запись идёт скриптом, который
// сверяет версию на стороне Redis. Не совпало — перечитываем и повторяем.

const CAS = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ok, doc = pcall(cjson.decode, cur)
  if ok and tostring(doc.v) ~= ARGV[1] then return 0 end
end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

// В памяти скрипта нет, поэтому та же проверка версии делается вручную.
async function compareAndSet(key, version, doc) {
  if (usingMemory) {
    const cur = await getJson(key);
    if (cur && String(cur.v) !== String(version)) return 0;
    memory.set(key, JSON.stringify(doc));
    return 1;
  }
  return command('EVAL', CAS, 1, key, String(version), JSON.stringify(doc));
}

export async function readDoc(key) {
  const doc = await getJson(key);
  if (doc && Array.isArray(doc.items)) return doc;
  return { v: 0, items: [] };
}

export const readItems = async (key) => (await readDoc(key)).items;

// mutate получает копию массива и возвращает новый; undefined — «не менялось».
export async function updateItems(key, mutate, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const doc = await readDoc(key);
    const next = await mutate(JSON.parse(JSON.stringify(doc.items)));
    if (next === undefined) return doc.items;
    const ok = await compareAndSet(key, doc.v, { v: doc.v + 1, items: next });
    if (ok) return next;
  }
  throw Object.assign(new Error('не удалось записать: слишком много одновременных изменений'), { status: 409 });
}
