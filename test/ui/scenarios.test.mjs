// Функциональные сценарии интерфейса. Запуск: npm run test:ui
//
// Эти сценарии — договор для любой вёрстки. Они написаны до переделки
// и после неё должны пройти без единой правки. Поэтому элементы ищутся
// по тому, что видит и читает человек:
//   · кнопки и подписи — по видимому тексту;
//   · поля и ячейки сетки — по aria-label;
//   · результат — по живому счётчику с role="status";
//   · состояние фильтров — по адресной строке.
// Классы и id разметки здесь не используются нигде.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowser, startSite } from './harness.mjs';

let site;
let browser;

before(async () => {
  site = await startSite();
  browser = await startBrowser();
});

after(async () => {
  await browser?.stop();
  site?.stop();
});

/* ── общие действия ──────────────────────────────────────────────────────── */

// Живой счётчик результата: «310 групп» или «Ничего не нашлось».
const COUNT = `__ui.all('[role="status"]').find((e) => /групп|ничего/i.test(e.textContent))`;

async function open(path, size) {
  const page = await browser.open(site.origin + path, size);
  await page.waitFor(`(${COUNT})`, { what: 'счётчик результата', timeout: 20000 });
  return page;
}

async function count(page) {
  const text = await page.eval(`__ui.norm((${COUNT}).textContent)`);
  if (/ничего/i.test(text)) return 0;
  const n = Number((text.match(/\d[\d\s]*/) || [''])[0].replace(/\s/g, ''));
  assert.ok(Number.isFinite(n), `не разобрал счётчик: «${text}»`);
  return n;
}

// Дождаться, пока счётчик станет другим, и вернуть новое значение.
async function countChangedFrom(page, before) {
  await page.waitFor(`(() => {
    const t = __ui.norm((${COUNT}).textContent);
    const n = /ничего/i.test(t) ? 0 : Number((t.match(/\\d[\\d\\s]*/) || [''])[0].replace(/\\s/g, ''));
    return n !== ${before};
  })()`, { what: `счётчик отличается от ${before}` });
  return count(page);
}

const button = (re, n = 0) => `__ui.text('button, a[href], [role="button"]', ${JSON.stringify(re)}, ${n})`;
const labelled = (re, n = 0) => `__ui.label(${JSON.stringify(re)}, ${n})`;
const labelText = (re, n = 0) => `__ui.text('label', ${JSON.stringify(re)}, ${n})`;
const pressed = (re) => `(() => __ui.all('button[aria-pressed="true"]').some((b) => new RegExp(${JSON.stringify(re)}, 'i').test(__ui.norm(b.textContent))))()`;

function noErrors(page) {
  assert.deepEqual(page.errors, [], `ошибки в консоли страницы:\n${page.errors.join('\n')}`);
}

/* ── 1. второй ребёнок ───────────────────────────────────────────────────── */

test('добавить второго ребёнка: оба возраста в адресе и блок «обоих сразу»', async () => {
  const page = await open('/');
  await page.click(button('^(указать возраст|добавить)'), 'кнопка «Указать возраст»');
  await page.fill(labelled('^Возраст ребёнка 1$'), 7);
  await page.waitFor(`new URLSearchParams(location.search).get('kids') === '7'`, { what: 'kids=7 в адресе' });

  await page.click(button('добавить ещё ребёнка'), 'кнопка «Добавить ещё ребёнка»');
  await page.fill(labelled('^Возраст ребёнка 2$'), 10);
  await page.waitFor(`new URLSearchParams(location.search).get('kids') === '7,10'`, { what: 'kids=7,10 в адресе' });

  const ages = await page.eval(`[1, 2].map((i) => __ui.label('^Возраст ребёнка ' + i + '$')?.value)`);
  assert.deepEqual(ages, ['7', '10']);
  await page.waitFor(`/обоих в одно время/i.test(document.body.innerText)`, { what: 'блок «обоих сразу»' });
  noErrors(page);
  await page.close();
});

/* ── 2. окно: протяжкой и пресетом ───────────────────────────────────────── */

test('закрасить окно протяжкой по сетке', async () => {
  const page = await open('/');
  const before = await count(page);

  await page.drag(labelled('^Понедельник, 16:00$'), `__ui.label('^Пятница, 18:00$')`);

  const params = await page.waitFor(`new URLSearchParams(location.search).get('win')`, { what: 'win в адресе' });
  assert.ok(params, 'окно не попало в адрес');
  const painted = await page.eval(`__ui.all('[aria-selected="true"][aria-label]').map((c) => c.getAttribute('aria-label').toLowerCase())`);
  // Пн–Пт × 16:00, 16:30, 17:00, 17:30, 18:00 — прямоугольник 5 × 5.
  assert.equal(painted.length, 25, `закрашено ${painted.length} ячеек: ${painted.slice(0, 6).join('; ')}…`);
  assert.ok(painted.includes('среда, 17:00'), 'среда 17:00 внутри прямоугольника');
  assert.ok(!painted.includes('суббота, 17:00'), 'суббота за пределами прямоугольника');

  const after = await countChangedFrom(page, before);
  assert.ok(after > 0 && after < before, `окно должно сузить выдачу: было ${before}, стало ${after}`);
  noErrors(page);
  await page.close();
});

test('закрасить окно пресетом: число на пресете совпадает с выдачей', async () => {
  const page = await open('/');
  const before = await count(page);
  const promised = await page.eval(`Number(((${button('^после школы')}).textContent.match(/\\d+/) || [0])[0])`);
  assert.ok(promised > 0, 'на пресете нет числа');

  await page.click(button('^после школы'), 'пресет «После школы»');
  await page.waitFor(`new URLSearchParams(location.search).get('win')`, { what: 'win в адресе' });
  await page.waitFor(pressed('^после школы'), { what: 'пресет отмечен нажатым' });

  const after = await countChangedFrom(page, before);
  assert.equal(after, promised, `пресет обещал ${promised}, выдача ${after}`);

  // Повторное нажатие снимает окно.
  await page.click(button('^после школы'));
  await page.waitFor(`!new URLSearchParams(location.search).get('win')`, { what: 'окно снято' });
  noErrors(page);
  await page.close();
});

/* ── 3. метро ────────────────────────────────────────────────────────────── */

test('выбрать станцию метро через поиск по списку', async () => {
  const page = await open('/');
  const before = await count(page);

  await page.click(labelText('^по метро$'), 'режим «По метро»');
  await page.waitFor(`new URLSearchParams(location.search).get('geo') === 'metro'`, { what: 'geo=metro' });
  await page.click(labelled('поиск станции'), 'поле поиска станции');
  await page.type('Спорт');
  await page.click(labelText('^Спортивная'), 'станция «Спортивная»');

  const m = await page.waitFor(`new URLSearchParams(location.search).get('m')`, { what: 'станция в адресе' });
  assert.ok(m, 'станция не попала в адрес');
  const after = await countChangedFrom(page, before);
  assert.ok(after > 0 && after < before, `было ${before}, стало ${after}`);
  noErrors(page);
  await page.close();
});

/* ── 4. пустой результат и подсказка ─────────────────────────────────────── */

test('пустой результат: подсказка обещает число и выполняет обещание', async () => {
  const page = await open('/?kids=3&dir=plavanie');
  assert.equal(await count(page), 0, 'этот запрос должен давать пустую выдачу');
  await page.waitFor(`/ничего нет/i.test(document.body.innerText)`, { what: 'сообщение «ничего нет»' });

  // Подсказка — кнопка в блоке «ничего нет», на которой написано, сколько
  // групп она даст. Ищем от заголовка, иначе попадётся «Все 310 групп» в шапке.
  const hint = `(() => {
    const h = __ui.all('h2, h3').find((x) => /ничего нет/i.test(x.textContent));
    let box = h;
    while (box && !box.querySelector('button')) box = box.parentElement;
    return box && [...box.querySelectorAll('button')].find((b) => __ui.visible(b) && /\\d+\\s*групп/i.test(b.textContent));
  })()`;
  const promised = await page.eval(`Number((${hint}).textContent.match(/(\\d+)\\s*групп/)[1])`);
  const url = await page.href();

  await page.click(hint, 'первая подсказка');
  const after = await countChangedFrom(page, 0);
  assert.equal(after, promised, `подсказка обещала ${promised}, выдача ${after}`);
  assert.notEqual(await page.href(), url, 'подсказка должна поменять адрес');
  noErrors(page);
  await page.close();
});

/* ── 5. сохранить поиск ──────────────────────────────────────────────────── */

test('сохранить поиск гостем: панель входа в потоке, без модального окна', async () => {
  const page = await open('/?kids=8');
  const n = await count(page);

  await page.click(button('^сохранить поиск'), 'кнопка «Сохранить поиск»');
  await page.waitFor(`/нужен вход/i.test(document.body.innerText)`, { what: 'объяснение, зачем вход' });

  const modal = await page.eval(`!!document.querySelector('[aria-modal="true"], dialog[open]')`);
  assert.equal(modal, false, 'гостю нельзя показывать модальное окно');
  assert.equal(await count(page), n, 'поиск под панелью входа должен остаться на месте');
  noErrors(page);
  await page.close();
});

// Этот сценарий нашёл баг: в демо-режиме шапка показывала вошедшего «Ивана»,
// а «Сохранить поиск» шёл в живой API и просил войти. Исправлено, метка todo
// снята — единственная правка сценария, остальное как было.
test('сохранить поиск в демо-режиме', async () => {
  const page = await open('/?kids=8&demo=1');
  await page.click(button('^сохранить поиск'), 'кнопка «Сохранить поиск»');
  await page.waitFor(`/сохранено/i.test(document.body.innerText)`, { what: 'подтверждение «Сохранено»' });
  noErrors(page);
  await page.close();
});

/* ── 6. сравнение ────────────────────────────────────────────────────────── */

test('добавить в сравнение: не больше трёх, таблица с выбранными', async () => {
  const page = await open('/?kids=8');
  const titles = await page.eval(`__ui.all('article h3, article h2').slice(0, 4).map((h) => __ui.norm(h.textContent))`);
  assert.ok(titles.length >= 4, 'в выдаче меньше четырёх карточек');

  await page.click(labelText('^сравнить$', 0), '«Сравнить» у первой карточки');
  await page.click(labelText('^сравнить$', 1), '«Сравнить» у второй карточки');
  await page.waitFor(`/выбрано 2 из 3/i.test(document.body.innerText)`, { what: '«Выбрано 2 из 3»' });

  await page.click(labelText('^сравнить$', 2));
  await page.waitFor(`/выбрано три группы/i.test(document.body.innerText)`, { what: 'предел в три группы' });
  await page.click(labelText('^сравнить$', 3));
  const checked = await page.eval(`__ui.all('label').filter((l) => /^сравнить$/i.test(__ui.norm(l.textContent)) && l.querySelector('input')?.checked).length`);
  assert.equal(checked, 3, 'четвёртая группа не должна попасть в сравнение');

  await page.click(`__ui.all('button').filter((b) => /^сравнить$/i.test(__ui.norm(b.textContent))).pop()`, 'кнопка «Сравнить» в панели');
  await page.waitFor(`!!document.querySelector('dialog[open] table')`, { what: 'таблица сравнения' });
  const table = await page.eval(`__ui.norm(document.querySelector('dialog[open]').textContent)`);
  for (const t of titles.slice(0, 3)) {
    // Заголовок карточки — «Направление: Название подтип», берём само название.
    const name = t.split(':').pop().trim().split(/\s+/)[0];
    assert.ok(table.includes(name), `в таблице нет «${name}»`);
  }
  noErrors(page);
  await page.close();
});

/* ── 7. ссылка с фильтрами ───────────────────────────────────────────────── */

test('ссылка с фильтрами восстанавливает то же состояние', async () => {
  // Собираем состояние руками…
  const a = await open('/');
  await a.click(button('^шахматы'), 'направление «Шахматы»');
  await a.click(button('^после школы'), 'пресет «После школы»');
  await a.click(button('^(указать возраст|добавить)'));
  await a.fill(labelled('^Возраст ребёнка 1$'), 9);
  await a.waitFor(`new URLSearchParams(location.search).get('kids') === '9'`);
  await a.eval(`(() => { const s = __ui.label('сортировк') || [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'price')); s.value = 'price'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await a.waitFor(`new URLSearchParams(location.search).get('sort') === 'price'`, { what: 'sort=price' });
  const href = await a.href();
  const n = await count(a);
  await a.close();

  // …и открываем ту же ссылку в чистой вкладке.
  const url = new URL(href);
  const b = await open(url.pathname + url.search);
  assert.equal(await count(b), n, 'по ссылке другая выдача');
  assert.deepEqual(await b.params(), Object.fromEntries(url.searchParams), 'адрес после загрузки изменился');
  await b.waitFor(pressed('^шахматы'), { what: '«Шахматы» отмечены' });
  await b.waitFor(pressed('^после школы'), { what: '«После школы» отмечено' });
  assert.equal(await b.eval(`__ui.label('^Возраст ребёнка 1$').value`), '9');
  assert.equal(await b.eval(`[...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'price')).value`), 'price');
  const painted = await b.eval(`document.querySelectorAll('[aria-selected="true"][aria-label]').length`);
  assert.ok(painted > 0, 'окно из ссылки не закрашено в сетке');
  noErrors(b);
  await b.close();
});

test('ссылка с метро открывает режим и отмечает станцию', async () => {
  const a = await open('/');
  await a.click(labelText('^по метро$'));
  await a.click(labelled('поиск станции'));
  await a.type('Спорт');
  await a.click(labelText('^Спортивная'));
  await a.waitFor(`new URLSearchParams(location.search).get('m')`);
  const href = await a.href();
  const n = await count(a);
  await a.close();

  const url = new URL(href);
  const b = await open(url.pathname + url.search);
  assert.equal(await count(b), n);
  const state = await b.eval(`({
    mode: __ui.text('label', '^по метро$')?.querySelector('input')?.checked,
    station: __ui.all('label').find((l) => /^Спортивная/.test(__ui.norm(l.textContent)))?.querySelector('input')?.checked
  })`);
  assert.deepEqual(state, { mode: true, station: true });
  noErrors(b);
  await b.close();
});

/* ── 8. шторка на телефоне ───────────────────────────────────────────────── */

test('шторка фильтров на 390 px', async () => {
  const page = await open('/', { width: 390, height: 844, mobile: true });
  const overflow = await page.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  assert.equal(overflow, 0, 'страница шире экрана');
  const before = await count(page);

  // Полоса «Фильтры» появляется, когда кнопка героя уходит за край экрана,
  // поэтому сначала прокручиваем. Это разрешённая правка сценария.
  await page.wheel(900);

  // До открытия шторки конструктора на экране нет, есть кнопка «Фильтры».
  assert.equal(await page.eval(`!!__ui.label('^Возраст ребёнка') || /когда удобно возить/i.test(__ui.all('h2, h3').map((h) => h.textContent).join(' '))`), false,
    'конструктор должен прятаться в шторку');
  await page.click(button('^фильтры'), 'кнопка «Фильтры»');
  await page.waitFor(`/когда удобно возить/i.test(__ui.all('h2, h3').map((h) => h.textContent).join(' '))`, { what: 'шторка открылась' });

  // Внутри шторки фильтр меняет число на кнопке применения, но не закрывает её.
  const chip = `__ui.all('button').filter((b) => /^шахматы/i.test(__ui.norm(b.textContent))).pop()`;
  await page.click(chip, 'направление «Шахматы» в шторке');
  const n = await page.waitFor(`(() => { const b = __ui.text('button', '^показать'); const m = b && b.textContent.match(/(\\d+)/); return m ? Number(m[1]) : 0; })()`, { what: 'число на кнопке «Показать»' });
  assert.ok(n > 0 && n < before, `на кнопке ${n}, было ${before}`);

  await page.click(button('^показать'), 'кнопка «Показать N групп»');
  await page.waitFor(`!/когда удобно возить/i.test(__ui.all('h2, h3').map((h) => h.textContent).join(' '))`, { what: 'шторка закрылась' });
  assert.equal(await count(page), n, 'выдача не совпала с обещанием на кнопке');
  assert.equal((await page.params()).dir, 'shahmaty');
  const focus = await page.eval(`__ui.norm(document.activeElement.textContent)`);
  assert.match(focus, /^фильтры/i, 'фокус должен вернуться на кнопку «Фильтры»');
  noErrors(page);
  await page.close();
});

/* ── новое поведение: отдельными сценариями, старые не тронуты ───────────── */

test('полоса «Фильтры» на телефоне: только когда кнопка героя за краем', async () => {
  const page = await open('/', { width: 390, height: 844, mobile: true });
  const barShown = `!!__ui.text('button', '^фильтры')`;

  // На первом экране кнопка героя видна — полоса её не дублирует.
  await page.waitFor(`!!__ui.text('a, button', '^подобрать кружок')`, { what: 'кнопка героя' });
  assert.equal(await page.eval(barShown), false, 'на первом экране полосы быть не должно');

  await page.wheel(900);
  await page.waitFor(barShown, { what: 'полоса появилась после прокрутки' });

  await page.wheel(-2000);
  await page.waitFor(`!(${barShown})`, { what: 'полоса спряталась у кнопки героя' });

  // Конец страницы не прячется под полосой: последняя ссылка подвала над ней.
  await page.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
  await page.waitFor(barShown);
  const gap = await page.eval(`(() => {
    const bar = __ui.text('button', '^фильтры').getBoundingClientRect();
    const last = __ui.all('footer a').pop().getBoundingClientRect();
    return Math.round(bar.top - last.bottom);
  })()`);
  assert.ok(gap >= 0, `полоса закрывает последнюю ссылку подвала на ${-gap} px`);

  // На узком экране кнопка героя сама открывает шторку: якорь ведёт в пустоту.
  await page.eval('window.scrollTo(0, 0)');
  await page.click(button('^подобрать кружок'), 'кнопка героя');
  await page.waitFor(`/когда удобно возить/i.test(__ui.all('h2, h3').map((h) => h.textContent).join(' '))`, { what: 'шторка открылась с кнопки героя' });
  noErrors(page);
  await page.close();
});

test('демо: сохранённый поиск и отслеживание видны в демо-кабинете', async () => {
  const page = await open('/?kids=8&demo=1');

  await page.click(button('^сохранить поиск'), 'кнопка «Сохранить поиск»');
  await page.waitFor(`/сохранено/i.test(document.body.innerText)`, { what: 'подтверждение' });
  assert.equal(await page.eval(`/нужен вход/i.test(document.body.innerText)`), false, 'в демо не просим войти');

  // Сердце на карточке, которой ещё нет в избранном заготовки.
  const title = await page.eval(`(() => {
    const card = __ui.all('article').find((a) => a.querySelector('[aria-pressed="false"][aria-label]'));
    card.dataset.pick = '1';
    return __ui.norm(card.querySelector('h3, h2').textContent).split(':').pop().trim().split(/\s+/)[0];
  })()`);
  await page.click(`document.querySelector('[data-pick="1"] [aria-pressed][aria-label]')`, 'сердце на карточке');
  await page.waitFor(`document.querySelector('[data-pick="1"] [aria-pressed][aria-label]').getAttribute('aria-pressed') === 'true'`, { what: 'сердце отмечено' });
  assert.equal(await page.eval(`/нужен вход/i.test(document.body.innerText)`), false, 'в демо не просим войти');

  // В той же вкладке — в демо-кабинет.
  await page.click(`__ui.text('a', '^открыть кабинет')`, 'ссылка «Открыть кабинет»');
  await page.waitFor(`/кабинет/i.test(document.title) && /8 лет/.test(document.body.innerText)`, { what: 'сохранённый поиск в кабинете' });
  await page.goto(site.origin + '/lk/?demo=1&tab=favs');
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(title)})`, { what: `«${title}» в избранном` });
  noErrors(page);
  await page.close();
});

test('ползунок возраста: стрелками меняет возраст, поле и адрес следуют', async () => {
  const page = await open('/?kids=8');
  await page.click(labelled('^Возраст ребёнка 1, ползунок$'), 'ползунок возраста');
  await page.key('ArrowRight');
  await page.key('ArrowRight');
  await page.waitFor(`new URLSearchParams(location.search).get('kids') === '10'`, { what: 'kids=10 в адресе' });
  assert.equal(await page.eval(`__ui.label('^Возраст ребёнка 1$').value`), '10', 'поле с числом отстало от ползунка');
  noErrors(page);
  await page.close();
});
