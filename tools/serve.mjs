// Локальный сервер. Ведёт себя как хостинг: /путь/ отдаёт index.html из
// каталога, а /api/* исполняет функцию из api/ так же, как это делает
// Vercel. Нужен потому, что модули не грузятся с file://, а кабинет без
// работающих функций не проверить.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, extname, join, normalize } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5180;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Функции Vercel на Node получают обычные req и res, поэтому подменять здесь
// нечего: надо найти файл и позвать его default export. Файлы из api/_lib
// не роутятся — подчёркивание не проходит проверку имени.
async function runApi(req, res, path) {
  // И /api/me, и /api/me/ — один адрес: на Vercel включён trailingSlash,
  // и он может переписывать одно в другое.
  const rel = path.slice('/api/'.length).replace(/\/+$/, '');
  if (!/^[a-z0-9/-]+$/.test(rel) || rel.includes('..')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Нет такой функции' }));
    return;
  }
  const file = join(ROOT, 'api', rel + '.mjs');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Нет функции /api/' + rel }));
    return;
  }
  // ?t= сбрасывает кэш модулей: правки подхватываются без перезапуска сервера.
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  await mod.default(req, res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path.includes('\0')) {
    res.writeHead(400).end('bad request');
    return;
  }

  if (path.startsWith('/api/')) {
    try {
      await runApi(req, res, path);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><p>404. <a href="/">На главную</a>');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
