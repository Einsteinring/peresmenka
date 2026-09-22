// Вход по ссылке на бота: сторона Telegram.
//
// Сюда стучится сервер Telegram, а не браузер. Это и делает способ надёжным:
// кто перед нами, сообщает сам мессенджер, подписывать и сверять нечего.
// Зато адрес открыт всему интернету, поэтому первое, что здесь происходит, —
// сверка секрета из заголовка. Не сошёлся — 401, тело даже не читаем.
//
// Отвечаем 200 на любое понятое обновление: на другой код Telegram начнёт
// повторять доставку, а повторять тут нечего.

import { handler, json, methodIs, ok, readBody } from '../_lib/http.mjs';
import { callApi, sendMessage, webhookSecretOk } from '../_lib/telegram.mjs';
import { confirmLink, dropLink, markAsked, nonceOk, profileFrom, readLink } from '../_lib/link.mjs';
import { registerUser } from '../_lib/account.mjs';

const HELLO =
  'Это бот сайта «Пересменка» — агрегатора детских кружков Петербурга.\n\n' +
  'Он присылает уведомления по сохранённым поискам и отслеживаемым группам. ' +
  'Чтобы войти, нажмите «Войти через приложение» на сайте: оттуда придёт ссылка с кодом.';

const STALE = 'Эта ссылка для входа устарела. Начните заново на сайте — заявка живёт десять минут.';

export default handler(async (req, res) => {
  if (!methodIs(req, 'POST')) return json(res, 405, { error: 'Только POST' });

  if (!webhookSecretOk(req)) {
    if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
      console.warn('вебхук выключен: не задан TELEGRAM_WEBHOOK_SECRET');
    }
    return json(res, 401, { error: 'Нет доступа' });
  }

  const update = await readBody(req);
  if (update.message) await onMessage(update.message);
  else if (update.callback_query) await onCallback(update.callback_query);

  ok(res, {});
});

/* ── /start ──────────────────────────────────────────────────────────────── */

async function onMessage(message) {
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const chat = message.chat?.id;
  if (!chat) return;

  if (!text.startsWith('/start')) return void (await sendMessage(chat, HELLO));

  const nonce = text.slice('/start'.length).trim();
  if (!nonce) return void (await sendMessage(chat, HELLO));
  if (!nonceOk(nonce)) return void (await sendMessage(chat, STALE));

  const profile = profileFrom(message.from);
  if (!profile) return;

  // Занять заявку может только тот, кто пришёл по ней первым: второй Start
  // по той же ссылке получит отказ и никого не подменит.
  const rec = await markAsked(nonce, profile);
  if (!rec) {
    const existing = await readLink(nonce);
    return void (await sendMessage(chat, existing ? 'Эта заявка уже используется.' : STALE));
  }

  await sendMessage(
    chat,
    'Вход на сайт <b>Пересменка</b>.\n\n' +
      `Код на странице: <b>${rec.code}</b>\n\n` +
      'Совпадает с тем, что открыто в браузере — подтвердите. ' +
      'Если вы сейчас ничего не открывали, значит ссылку прислал кто-то чужой: нажмите «Это не я».',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Подтвердить вход · ${rec.code}`, callback_data: `ok:${nonce}` }],
          [{ text: 'Это не я', callback_data: `no:${nonce}` }]
        ]
      }
    }
  );
}

/* ── кнопки ──────────────────────────────────────────────────────────────── */

async function onCallback(cq) {
  const data = typeof cq.data === 'string' ? cq.data : '';
  const [action, nonce] = [data.slice(0, 2), data.slice(3)];
  const answer = (text, alert = false) =>
    callApi('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert });
  const replace = (text) =>
    cq.message
      ? callApi('editMessageText', {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          text,
          parse_mode: 'HTML'
        })
      : null;

  if (action === 'no') {
    await dropLink(nonce);
    await answer('Вход отменён');
    return void (await replace('Вход отменён. Если ссылку прислал кто-то посторонний — просто не открывайте её.'));
  }

  if (action !== 'ok') return;

  // id берём из обновления, а не из кнопки: данные кнопки видны в чате,
  // а отправитель нажатия — нет.
  const rec = await confirmLink(nonce, cq.from?.id);
  if (!rec) {
    await answer('Заявка устарела. Начните вход заново на сайте.', true);
    return;
  }

  await registerUser(rec.profile, { tgOk: true });
  await answer('Готово');
  await replace('Вход подтверждён. Вернитесь на вкладку с сайтом — она уже открывает кабинет.');
}
