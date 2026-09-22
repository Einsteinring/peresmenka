// Привязка вебхука бота. Запускается руками, один раз на домен.
//
//   node --env-file=.env tools/set-webhook.mjs          привязать
//   node --env-file=.env tools/set-webhook.mjs --info   посмотреть, что сейчас
//   node --env-file=.env tools/set-webhook.mjs --delete отвязать
//   node tools/set-webhook.mjs --secret                 придумать секрет
//
// Секреты берутся из окружения и в вывод не попадают.

import { randomBytes } from 'node:crypto';

const arg = process.argv[2] || '';

if (arg === '--secret') {
  console.log(randomBytes(24).toString('base64url'));
  console.log('\nПоложите это в TELEGRAM_WEBHOOK_SECRET — и в .env, и в переменные Vercel.');
  process.exit(0);
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIGIN = process.env.SITE_ORIGIN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!TOKEN) die('Нет TELEGRAM_BOT_TOKEN.');

async function api(method, payload) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  } catch (err) {
    // Самая частая причина не «Telegram недоступен», а прокси: curl берёт
    // HTTPS_PROXY из окружения сам, а fetch в Node — только по флагу.
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    console.error(`Не удалось достучаться до api.telegram.org: ${err.cause?.code || err.message}`);
    if (proxy) {
      console.error(`\nВ окружении есть прокси ${proxy}, но fetch его не видит. Повторите так:`);
      console.error('  node --use-env-proxy --env-file=.env tools/set-webhook.mjs');
    } else {
      console.error('\nПохоже, Telegram отсюда не открывается. Включите VPN и повторите.');
    }
    process.exit(1);
  }
  const body = await res.json().catch(() => ({}));
  if (!body.ok) die(`${method}: ${body.description || res.status}`);
  return body.result;
}

const who = await api('getMe');
console.log(`Бот: @${who.username}\n`);

if (arg === '--info') {
  const info = await api('getWebhookInfo');
  console.log(`адрес            ${info.url || '— не задан —'}`);
  console.log(`в очереди        ${info.pending_update_count}`);
  if (info.last_error_message) {
    console.log(`последняя ошибка ${info.last_error_message}`);
    console.log(`                 ${new Date(info.last_error_date * 1000).toLocaleString('ru-RU')}`);
  } else if (info.url) {
    console.log('последняя ошибка —');
  }
  console.log('');
  console.log('Если тут 401 — на Vercel не задан TELEGRAM_WEBHOOK_SECRET или он не тот, чем привязывали.');
  process.exit(0);
}

if (arg === '--delete') {
  await api('deleteWebhook', { drop_pending_updates: true });
  console.log('Вебхук отвязан. Вход по ссылке на бота работать не будет.');
  process.exit(0);
}

if (!ORIGIN) die('Нет SITE_ORIGIN.');
if (!SECRET) die('Нет TELEGRAM_WEBHOOK_SECRET. Придумать: node tools/set-webhook.mjs --secret');
if (!/^[\x21-\x7e]{1,256}$/.test(SECRET)) {
  // Тот же случай, что с CRON_SECRET: значение уезжает заголовком, и всё,
  // что вне ASCII, ломает не вход, а сборку целиком.
  die('TELEGRAM_WEBHOOK_SECRET должен быть из латиницы, цифр и знаков: он едет в HTTP-заголовке.');
}

// Слэш на конце обязателен. На сайте включён trailingSlash, адрес без слэша
// отвечает 308 — а Telegram по редиректам за вебхуком не ходит.
const url = `${ORIGIN.replace(/\/+$/, '')}/api/tg/webhook/`;

await api('setWebhook', {
  url,
  secret_token: SECRET,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true
});

const info = await api('getWebhookInfo');
console.log(`Вебхук привязан: ${info.url}`);
console.log('Обновления: message, callback_query. Остальное Telegram нам не шлёт.');
console.log('\nПроверить потом: node --env-file=.env tools/set-webhook.mjs --info');
