// Демо-кабинет: вымышленный человек с заполненными разделами.
//
// Собирается из настоящего каталога, чтобы все id и адреса существовали и
// карточки выглядели как настоящие. Запускается вместе со сборкой.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndex, search } from '../js/model.js';
import { parseQuery } from '../js/state.js';
import { describeQuery } from '../js/describe.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (n) => JSON.parse(readFileSync(join(ROOT, 'data', n), 'utf8'));
const index = buildIndex(read('catalog.json'), read('geo.json'));

const now = new Date();
const shift = (days, hour = 18, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const pick = (dir, n = 1) => index.groups.filter((g) => g.direction === dir).slice(0, n);

const SEARCHES = [
  '?kids=8&win=12345:1080-1320&geo=metro&m=petrogradskaya,chkalovskaya',
  '?dir=plavanie&kids=7&win=67:540-780',
  '?kids=6,9&win=67:540-900&geo=rayon&r=vasileostrovskiy'
];

const saves = SEARCHES.map((s, i) => {
  const q = parseQuery(s);
  return {
    id: `demo-save-${i + 1}`,
    name: describeQuery(q, index),
    search: s,
    notify: i !== 2,
    created_at: shift(-20 - i * 6, 12),
    count: search(index, q).total
  };
});

const favGroups = [...pick('tancy', 2), ...pick('shahmaty', 1), ...pick('robototehnika', 1), ...pick('muzyka', 1)];
const leadGroups = [...pick('shahmaty', 1), ...pick('risovanie', 1)];

const view = (g) => ({
  id: g.id,
  url: `/g/${g.id}-${g.slug}/`,
  direction: g.direction,
  dirShort: g.dir.short,
  title: g.title,
  org: g.org.name,
  address: g.branch.address,
  station: g.branch.stationName,
  ages: `${g.ageFrom}—${g.ageTo}`,
  priceMonth: g.priceMonth,
  schedule: g.lessons.map((l) => `${['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][l.day]} ${String(Math.floor(l.start / 60)).padStart(2, '0')}:${String(l.start % 60).padStart(2, '0')}—${String(Math.floor(l.end / 60)).padStart(2, '0')}:${String(l.end % 60).padStart(2, '0')}`).join(', '),
  brings: g.brings.join(', '),
  intakeStart: g.intakeStart
});

const demo = {
  demo: true,
  user: { id: 0, first_name: 'Иван', last_name: 'К.', username: 'demo' },
  prefs: { channels: { web: true, telegram: true }, quiet: { from: 1320, to: 480 }, tg_ok: true },
  saves,
  favs: favGroups.map((g, i) => ({
    ...view(g),
    added_at: shift(-14 + i, 10),
    // У первой группы цена выросла, у второй упала — чтобы обе подписи
    // было видно. Форматирует клиент, здесь только числа.
    priceWas: i === 0 ? g.priceMonth - 400 : i === 1 ? g.priceMonth + 300 : null,
    priceDown: i === 1
  })),
  leads: [
    {
      id: 'demo-lead-1',
      status: 'replied',
      child: 'Маша',
      childAge: 8,
      callTime: 'вечером, 17:00—21:00',
      trialAt: shift(1, 11, 0),
      trialSoon: true,
      history: [
        { status: 'sent', at: shift(-3, 19, 12) },
        { status: 'replied', at: shift(-3, 19, 13) }
      ],
      group: view(leadGroups[0])
    },
    {
      id: 'demo-lead-2',
      status: 'visited',
      child: 'Гриша',
      childAge: 6,
      callTime: 'в любое время',
      trialAt: shift(-6, 17, 30),
      trialSoon: false,
      history: [
        { status: 'sent', at: shift(-9, 21, 40) },
        { status: 'replied', at: shift(-9, 21, 41) },
        { status: 'visited', at: shift(-6, 19, 0) }
      ],
      group: view(leadGroups[1])
    }
  ],
  notes: [
    {
      id: 'demo-note-1',
      kind: 'new_match',
      dir: favGroups[0].direction,
      title: `Новая группа по поиску «${saves[0].name}»`,
      body: `${view(favGroups[0]).dirShort}: ${favGroups[0].title}, ${favGroups[0].org.name}. ${favGroups[0].branch.address}.`,
      url: `/${SEARCHES[0]}`,
      created_at: shift(0, 9, 12),
      read_at: null
    },
    {
      id: 'demo-note-2',
      kind: 'trial_tomorrow',
      dir: leadGroups[0].direction,
      title: 'Завтра пробное занятие',
      body: `${leadGroups[0].dir.short}: ${leadGroups[0].title} — 11:00, ${leadGroups[0].branch.address}. Взять: ${leadGroups[0].brings.join(', ')}.`,
      url: '/lk/?tab=leads',
      created_at: shift(0, 8, 5),
      read_at: null
    },
    {
      id: 'demo-note-3',
      kind: 'intake_closing',
      dir: favGroups[2].direction,
      title: `Набор закрывается: ${favGroups[2].dir.short}: ${favGroups[2].title}`,
      body: 'Занятия начинаются через 4 дня.',
      url: view(favGroups[2]).url,
      created_at: shift(-1, 10, 30),
      read_at: null
    },
    {
      id: 'demo-note-4',
      kind: 'lead_reply',
      dir: leadGroups[0].direction,
      title: `Центр ответил на заявку: ${leadGroups[0].dir.short}: ${leadGroups[0].title}`,
      body: `${leadGroups[0].org.name} подтверждает пробное. Адрес: ${leadGroups[0].branch.address}.`,
      url: '/lk/?tab=leads',
      created_at: shift(-3, 19, 13),
      read_at: shift(-3, 20, 0)
    },
    {
      id: 'demo-note-5',
      kind: 'price_changed',
      dir: favGroups[1].direction,
      title: `Цена изменилась: ${favGroups[1].dir.short}: ${favGroups[1].title}`,
      body: `Было ${favGroups[1].priceMonth + 300} ₽, стало ${favGroups[1].priceMonth} ₽ в месяц.`,
      url: view(favGroups[1]).url,
      created_at: shift(-5, 14, 2),
      read_at: shift(-5, 18, 0)
    },
    {
      id: 'demo-note-6',
      kind: 'org_new_intake',
      dir: favGroups[3].direction,
      title: `Новый набор в центре «${favGroups[3].org.shortName || favGroups[3].org.name}»`,
      body: `${favGroups[3].dir.short}: ${favGroups[3].title}, ${favGroups[3].ageFrom}—${favGroups[3].ageTo} лет. Вы отслеживаете здесь другую группу.`,
      url: view(favGroups[3]).url,
      created_at: shift(-8, 11, 45),
      read_at: shift(-8, 12, 0)
    }
  ]
};

demo.unread = demo.notes.filter((n) => !n.read_at).length;

writeFileSync(join(ROOT, 'data', 'demo-account.json'), JSON.stringify(demo), 'utf8');
console.log(`Демо-кабинет: ${demo.saves.length} поиска, ${demo.favs.length} в избранном, ${demo.leads.length} заявки, ${demo.notes.length} уведомлений (${demo.unread} непрочитанных)`);
