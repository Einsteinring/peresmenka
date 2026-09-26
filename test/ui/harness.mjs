// Обвязка для сценариев в браузере. Без зависимостей: установленный Edge,
// запущенный с портом отладки, и сырой CDP через глобальный WebSocket из Node.
//
// Почему не Playwright: проект держит ноль зависимостей, а сам Playwright
// на этой машине всё равно не запустит Edge — он поставлен как MSIX-пакет,
// и штатный запуск падает. Подключение по порту отладки работает.
//
// Сценарии ищут элементы так, как их ищет человек: по видимому тексту,
// по aria-label, по состоянию в адресной строке. Классы разметки в них не
// участвуют — поэтому те же сценарии проходят и после смены вёрстки.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHttp(url, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`не дождался ${url}`);
}

function edgePath() {
  if (process.env.EDGE_PATH) return process.env.EDGE_PATH;
  const base = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application';
  // Свежая версия в подпапке надёжнее заглушки, но подходит и заглушка.
  try {
    const versions = readdirSync(base).filter((d) => /^\d+\./.test(d)).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      const exe = join(base, v, 'msedge.exe');
      if (existsSync(exe)) return exe;
    }
  } catch {}
  return join(base, 'msedge.exe');
}

/* ── сайт ────────────────────────────────────────────────────────────────── */

// Свой сервер на свободном порту. Ключи Upstash и Telegram заданы пустыми
// строками намеренно: tools/serve.mjs не перетирает уже заданное, и без этого
// он подхватил бы настоящий .env — сценарии писали бы в боевую базу.
// Секрет вебхука — тестовый: сценарий входа сам играет роль Telegram и
// стучится в /api/tg/webhook/. Без токена бота ответы бота никуда не уходят.
const WEBHOOK_SECRET = 'ui-test-webhook-secret';

export async function startSite() {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_BOT_USERNAME: 'peresmenka_test_bot',
    SITE_ORIGIN: `http://127.0.0.1:${port}`,
    CRON_SECRET: ''
  };
  const proc = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs')], { cwd: ROOT, env, stdio: 'ignore' });
  const origin = `http://127.0.0.1:${port}`;
  await waitHttp(`${origin}/`);
  return { origin, webhookSecret: WEBHOOK_SECRET, stop: () => proc.kill() };
}

/* ── браузер ─────────────────────────────────────────────────────────────── */

export async function startBrowser() {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'peresmenka-ui-'));
  const proc = spawn(edgePath(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });
  await waitHttp(`http://127.0.0.1:${port}/json/version`);

  const pages = new Set();
  return {
    async open(url, { width = 1440, height = 900, mobile = false } = {}) {
      const page = await openPage(port, url, { width, height, mobile });
      pages.add(page);
      return page;
    },
    async stop() {
      for (const p of pages) await p.close().catch(() => {});
      proc.kill();
      await sleep(600);
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    }
  };
}

// В каждой вкладке заранее кладём поиск «как у человека»: по видимому тексту
// и по подписи. Скрытые элементы не находятся — нажать на них нельзя.
const FINDERS = `
window.__ui = {
  visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden]')) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  },
  norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); },
  all(sel) { return [...document.querySelectorAll(sel)].filter((e) => this.visible(e)); },
  text(sel, re, n = 0) {
    const rx = new RegExp(re, 'i');
    return this.all(sel).filter((e) => rx.test(this.norm(e.textContent)))[n] || null;
  },
  label(re, n = 0) {
    const rx = new RegExp(re, 'i');
    return this.all('[aria-label]').filter((e) => rx.test(e.getAttribute('aria-label')))[n] || null;
  }
};`;

async function openPage(port, url, { width, height, mobile }) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message}`));
      else resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FINDERS });
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height
  });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const page = {
    errors,

    async goto(u) {
      await send('Page.navigate', { url: u });
      await page.waitFor('document.readyState === "complete"');
      await page.waitFor('!!window.__ui');
    },

    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`в странице: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expression}`);
      return r.result.value;
    },

    async waitFor(expression, { timeout = 10000, what } = {}) {
      const until = Date.now() + timeout;
      let last;
      while (Date.now() < until) {
        try {
          last = await page.eval(`(() => { try { return (${expression}); } catch { return false; } })()`);
          if (last) return last;
        } catch {}
        await sleep(100);
      }
      throw new Error(`не дождался: ${what || expression}`);
    },

    // Центр элемента в координатах окна. Элемент задаётся выражением,
    // которое его возвращает, например: __ui.text('button', '^Фильтры').
    async point(finder, what) {
      const p = await page.waitFor(`(() => {
        const el = ${finder};
        if (!el || !__ui.visible(el)) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`, { what: what || finder });
      return p;
    },

    async click(finder, what) {
      const { x, y } = await page.point(finder, what);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(80);
    },

    // Протяжка мышью: нажать на одном элементе, провести через промежуточные
    // точки к другому, отпустить. Как делает человек, а не как событие.
    async drag(fromFinder, toFinder) {
      const a = await page.point(fromFinder);
      const b = await page.eval(`(() => { const r = (${toFinder}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const y = a.y + ((b.y - a.y) * i) / steps;
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        await sleep(15);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(120);
    },

    // Заменить значение поля: выделить всё, напечатать, уйти Tab'ом —
    // так срабатывает change, как у живого человека.
    async fill(finder, text, what) {
      await page.click(finder, what);
      await page.key('a', { ctrl: true });
      await send('Input.insertText', { text: String(text) });
      await page.key('Tab');
    },

    // Прокрутка колесом, как у человека: страница едет, наблюдатели
    // пересечений срабатывают так же, как в жизни.
    async wheel(dy, at = { x: 100, y: 200 }) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: dy });
      await sleep(250);
    },

    // Куки вкладки, включая httpOnly: со страницы их не видно, только по CDP.
    async cookies() {
      const r = await send('Network.getCookies', {});
      return r.cookies;
    },
    async setCookie(name, value, url) {
      await send('Network.setCookie', { name, value, url, path: '/', httpOnly: true, sameSite: 'Lax' });
    },

    // Поворот телефона: та же вкладка, новые размеры окна и ориентация.
    // Страница получает resize и orientationchange, как на живом телефоне.
    async resize(w, h, isMobile = mobile) {
      const landscape = w > h;
      await send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: isMobile, screenWidth: w, screenHeight: h,
        screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 }
      });
      await sleep(400);
    },

    async type(text) {
      await send('Input.insertText', { text: String(text) });
      await sleep(60);
    },

    async key(key, { ctrl = false, shift = false } = {}) {
      const codes = { Tab: 9, Enter: 13, Escape: 27, a: 65, ArrowLeft: 37, ArrowRight: 39 };
      const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const base = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: codes[key] || 0, modifiers };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (key.length === 1 && !ctrl) await send('Input.dispatchKeyEvent', { type: 'char', text: key, ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(60);
    },

    // Снимок полосы страницы от y до y + height в координатах документа.
    // Нужен сборке design/compare.html, сценарии им не пользуются.
    // scale 2 — снимок с двойной плотностью (превью для портфолио).
    async shot(y, height, width, scale = 1) {
      await page.eval('document.fonts.ready.then(() => true)');
      // Режим «за пределами экрана» временно растягивает вьюпорт на весь
      // документ, и вёрстка, зависящая от высоты окна, снимается не такой,
      // как на экране. Поэтому он включается, только если полоса не влезает.
      // Координаты clip — от начала документа в обоих режимах. Раньше в
      // режиме «в окне» передавалось y − scrollY, и на прокрученной
      // странице снимался пустой, ещё не нарисованный верх документа.
      const inView = await page.eval(`scrollY <= ${y} && ${y + height} <= scrollY + innerHeight`);
      const r = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: !inView,
        clip: { x: 0, y, width, height, scale }
      });
      return Buffer.from(r.data, 'base64');
    },

    // Снимок ровно того, что на экране, вместе с закреплёнными элементами.
    async shotViewport() {
      await page.eval('document.fonts.ready.then(() => true)');
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      return Buffer.from(r.data, 'base64');
    },

    params: () => page.eval('Object.fromEntries(new URLSearchParams(location.search))'),
    href: () => page.eval('location.href'),

    async close() {
      try { ws.close(); } catch {}
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    }
  };

  await page.goto(url);
  return page;
}
