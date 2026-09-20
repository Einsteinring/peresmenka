// Ответы, тело запроса и проверка источника. Одинаково для всех функций,
// чтобы каждая не изобретала свой формат ошибки.

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export const ok = (res, body = {}) => json(res, 200, body);
export const bad = (res, message) => json(res, 400, { error: message });
export const unauthorized = (res) => json(res, 401, { error: 'Нужен вход' });
export const notFound = (res) => json(res, 404, { error: 'Не найдено' });

// Тело читается по-разному: локальный сервер отдаёт поток, Vercel уже
// разобранный объект, а на кривом JSON — что угодно. Любая неудача здесь
// должна стать честным 400, а не «внутренней ошибкой»: сломанный запрос
// шлёт бот, а не наш код ломается.
export async function readBody(req) {
  let value;
  try {
    // На Vercel это ленивый геттер: он сам разбирает JSON и бросает прямо
    // на обращении, если тело кривое. Поэтому даже чтение свойства — внутри
    // try, иначе ошибка минует всю обработку ниже и станет 500.
    value = req.body;
  } catch {
    throw Object.assign(new Error('Ожидался объект JSON'), { status: 400 });
  }

  if (value === undefined || value === null) {
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) throw Object.assign(new Error('Тело запроса слишком большое'), { status: 413 });
        chunks.push(chunk);
      }
    } catch (err) {
      if (err.status) throw err;
      throw Object.assign(new Error('Не удалось прочитать тело запроса'), { status: 400 });
    }
    value = Buffer.concat(chunks).toString('utf8');
  }

  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') value = safeParse(value);

  // Массив, число или строка вместо объекта — не то, чего ждёт любой
  // обработчик, и разбираться с этим по месту не нужно.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Ожидался объект JSON'), { status: 400 });
  }
  return value;
}

function safeParse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Ожидался JSON'), { status: 400 });
  }
}

// Куки httpOnly + SameSite=Lax уже отсекают межсайтовые POST, но Origin
// проверяем отдельно: на мутациях цена ошибки выше стоимости четырёх строк.
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin запросы без Origin (например, curl)
  const allowed = [process.env.SITE_ORIGIN, 'http://localhost:5180', 'http://127.0.0.1:5180'].filter(Boolean);
  return allowed.includes(origin);
}

export function methodIs(req, ...methods) {
  return methods.includes((req.method || 'GET').toUpperCase());
}

// Оборачивает обработчик: ошибки не утекают стеком наружу, но пишутся в лог.
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('api error', err);
      json(res, status, { error: status >= 500 ? 'Внутренняя ошибка' : err.message });
    }
  };
}
