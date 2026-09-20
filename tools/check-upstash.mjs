// Проверка Upstash перед деплоем: отвечает ли база, работает ли запись,
// и — главное — поддерживает ли она EVAL.
//
// EVAL здесь не роскошь: на нём держится запись с проверкой версии, которая
// не даёт двум вкладкам затереть правки друг друга. Если скриптов нет,
// об этом надо узнать сейчас, а не по потерянным данным.
//
// Запуск:  node --env-file=.env tools/check-upstash.mjs
// Секреты берутся из окружения и в вывод не попадают.

const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!URL_ || !TOKEN) {
  console.error('Нет UPSTASH_REDIS_REST_URL или UPSTASH_REDIS_REST_TOKEN.');
  console.error('Положите их в .env и запустите: node --env-file=.env tools/check-upstash.mjs');
  process.exit(1);
}

async function cmd(...args) {
  const started = performance.now();
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String))
  });
  const ms = Math.round(performance.now() - started);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return { result: body.result, ms };
}

const KEY = 'peresmenka:healthcheck';
let failed = false;
const say = (ok, text) => {
  if (!ok) failed = true;
  console.log(`  ${ok ? 'ок  ' : 'НЕТ '} ${text}`);
};

try {
  console.log(`База: ${new URL(URL_).host}\n`);

  const ping = await cmd('SET', KEY, 'ok', 'EX', 60);
  say(ping.result === 'OK', `запись работает (${ping.ms} мс)`);

  const read = await cmd('GET', KEY);
  say(read.result === 'ok', `чтение работает (${read.ms} мс)`);

  // Тот самый скрипт, которым идёт запись с проверкой версии.
  const CAS = "local cur = redis.call('GET', KEYS[1]) if cur then return 1 end return 0";
  const evaled = await cmd('EVAL', CAS, 1, KEY);
  say(evaled.result === 1, `EVAL работает — блокировка по версии будет надёжной (${evaled.ms} мс)`);

  const gone = await cmd('DEL', KEY);
  say(gone.result === 1, 'удаление работает, тестовый ключ убран');

  const slow = [ping.ms, read.ms, evaled.ms].some((ms) => ms > 250);
  if (slow) {
    console.log('\n  Задержка больше 250 мс. Обычно это значит, что регион базы');
    console.log('  и регион функций Vercel разные. Кабинет делает 4–6 запросов');
    console.log('  на открытие, так что это заметно.');
  }
} catch (err) {
  failed = true;
  console.log(`  НЕТ  ${err.message}`);
  console.log('\n  Проверьте, что скопированы именно REST URL и REST TOKEN,');
  console.log('  а не строка подключения redis:// и не read-only токен.');
}

console.log(failed ? '\nЕсть проблемы.' : '\nВсё в порядке, можно деплоить.');
process.exit(failed ? 1 : 0);
