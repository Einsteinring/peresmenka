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

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? safeParse(req.body) : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error('Тело запроса слишком большое'), { status: 413 });
    chunks.push(chunk);
  }
  return safeParse(Buffer.concat(chunks).toString('utf8'));
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
