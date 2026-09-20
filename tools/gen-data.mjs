// Генератор демонстрационного каталога.
//
// Детерминирован при фиксированном сиде: одни и те же id при каждом запуске.
// Недетерминированы только даты — они считаются от дня сборки, чтобы каталог
// не показывал прошлогодний набор. Запускается на каждой сборке (npm run build).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 20260920;

/* ── генератор случайных чисел ───────────────────────────────────────────── */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(SEED);
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

function weighted(pairs) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── транслитерация для слагов ───────────────────────────────────────────── */

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

function slugify(text) {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ── справочники ─────────────────────────────────────────────────────────── */

const DIRECTIONS = [
  {
    id: 'robototehnika',
    name: 'Робототехника и программирование',
    short: 'Робототехника',
    genitive: 'робототехники',
    slug: 'robototehnika',
    share: 14,
    affinity: 'outer',
    ageSpan: [6, 16],
    duration: [90, 90, 120],
    price: [4200, 8200],
    subtypes: ['конструирование', 'Scratch', 'Python', 'Arduino', 'дроны'],
    brings: ['сменную обувь', 'тетрадь в клетку'],
    about: 'Собирают и программируют роботов, разбирают задачу на шаги и доводят модель до работающей.'
  },
  {
    id: 'plavanie',
    name: 'Плавание',
    short: 'Плавание',
    genitive: 'плавания',
    slug: 'plavanie',
    share: 7,
    affinity: 'even',
    ageSpan: [5, 14],
    duration: [45, 45, 60],
    price: [3600, 7600],
    subtypes: null,
    brings: ['шапочку', 'очки', 'сланцы', 'справку от педиатра'],
    about: 'Ставят технику на воде: вдох-выдох, кроль, спина. Группы делят по умению держаться на воде, а не только по возрасту.',
    needsPool: true
  },
  {
    id: 'muzyka',
    name: 'Музыка',
    short: 'Музыка',
    genitive: 'музыки',
    slug: 'muzyka',
    share: 13,
    affinity: 'center',
    ageSpan: [5, 16],
    duration: [45, 45, 60],
    price: [4400, 9600],
    subtypes: ['фортепиано', 'гитара', 'скрипка', 'вокал', 'барабаны', 'флейта'],
    brings: ['нотную тетрадь'],
    about: 'Инструмент, слух и чтение с листа. Дома нужно заниматься по 20 минут в день, иначе занятия не имеют смысла.'
  },
  {
    id: 'yazyki',
    name: 'Иностранные языки',
    short: 'Языки',
    genitive: 'языков',
    slug: 'yazyki',
    share: 16,
    affinity: 'center',
    ageSpan: [5, 16],
    duration: [60, 60, 90],
    price: [3800, 8800],
    subtypes: ['английский', 'немецкий', 'испанский', 'французский', 'китайский'],
    brings: ['тетрадь', 'учебник выдаём на первом занятии'],
    about: 'Говорят с первого занятия, грамматику разбирают по ходу. Группы небольшие, чтобы каждый успевал сказать.'
  },
  {
    id: 'shahmaty',
    name: 'Шахматы',
    short: 'Шахматы',
    genitive: 'шахмат',
    slug: 'shahmaty',
    share: 13,
    affinity: 'center',
    ageSpan: [5, 15],
    duration: [60, 60, 90],
    price: [2800, 6400],
    subtypes: null,
    brings: ['тетрадь для записи партий'],
    about: 'Дебюты, тактика, разбор своих партий. Раз в месяц внутренний турнир с записью результатов.'
  },
  {
    id: 'risovanie',
    name: 'Художественная школа',
    short: 'Рисование',
    genitive: 'рисования',
    slug: 'risovanie',
    share: 11,
    affinity: 'even',
    ageSpan: [5, 16],
    duration: [90, 90, 120],
    price: [3600, 7800],
    subtypes: ['академический рисунок', 'живопись', 'графика', 'керамика', 'иллюстрация'],
    brings: ['фартук', 'бумагу А3', 'простые карандаши'],
    about: 'Композиция, светотень, работа с натуры. Материалы для первых занятий у нас, дальше список выдаём.'
  },
  {
    id: 'edinoborstva',
    name: 'Единоборства',
    short: 'Единоборства',
    genitive: 'единоборств',
    slug: 'edinoborstva',
    share: 13,
    affinity: 'outer',
    ageSpan: [5, 16],
    duration: [60, 60, 90],
    price: [3000, 6800],
    subtypes: ['дзюдо', 'карате', 'самбо', 'тхэквондо', 'бокс'],
    brings: ['форму', 'бутылку воды', 'справку от педиатра'],
    about: 'Разминка, техника, работа в парах. Спарринги только с защитой и не раньше второго года.'
  },
  {
    id: 'tancy',
    name: 'Танцы',
    short: 'Танцы',
    genitive: 'танцев',
    slug: 'tancy',
    share: 11,
    affinity: 'even',
    ageSpan: [4, 16],
    duration: [60, 60, 90],
    price: [3200, 7200],
    subtypes: ['современные', 'бальные', 'хип-хоп', 'балет', 'народные'],
    brings: ['форму', 'чешки или кроссовки в зал'],
    about: 'Растяжка, связки, постановка. Два раза в год отчётный концерт, костюм оплачивается отдельно.'
  },
  {
    id: 'teatr',
    name: 'Театральная студия',
    short: 'Театр',
    genitive: 'театра',
    slug: 'teatr',
    share: 6,
    affinity: 'center',
    ageSpan: [6, 16],
    duration: [90, 90, 120],
    price: [3400, 6600],
    subtypes: null,
    brings: ['удобную одежду', 'сменную обувь'],
    about: 'Речь, сценическое движение, этюды. К концу года выпускают спектакль и играют его трижды.'
  }
];

const ORG_WORDS = [
  'Кульман', 'Тура', 'Верста', 'Компас', 'Фонарь', 'Метроном', 'Гравюра', 'Шпиль',
  'Кильватер', 'Понтон', 'Слобода', 'Лестница', 'Обертон', 'Циркуль', 'Флюгер',
  'Стапель', 'Камертон', 'Грифель', 'Ватерлиния', 'Форштевень', 'Пятый угол',
  'Белый шум', 'Первый этаж', 'Мансарда', 'Антресоль', 'Полдень', 'Аквилон',
  'Грот', 'Кабельтов', 'Лоция', 'Румб', 'Траверз', 'Шкала', 'Оттиск', 'Литера',
  'Эскиз', 'Планшет', 'Пунктир', 'Ракурс', 'Разворот', 'Типография', 'Сурик',
  'Охра', 'Кобальт', 'Умбра', 'Сангина', 'Пастель', 'Левкас', 'Темпера', 'Штрих'
];

const ORG_KINDS = ['Студия', 'Клуб', 'Центр', 'Школа', 'Мастерская', 'Лаборатория'];

// Улицы привязаны к своим районам: Московский проспект у Проспекта Ветеранов
// петербуржец заметит быстрее, чем любую другую ошибку в данных.
const STREETS = {
  petrogradskiy: [
    'Большая Пушкарская ул.', 'ул. Ленина', 'Гатчинская ул.', 'Съезжинская ул.',
    'Кронверкская ул.', 'ул. Блохина', 'Малый пр. П.С.', 'Чкаловский пр.',
    'Ждановская наб.', 'Введенская ул.', 'Каменноостровский пр.', 'ул. Куйбышева',
    'Большой пр. П.С.', 'Полозова ул.', 'Бармалеева ул.', 'ул. Профессора Попова'
  ],
  vasileostrovskiy: [
    '6-я линия В.О.', '10-я линия В.О.', 'Средний пр. В.О.', 'ул. Беринга',
    'Наличная ул.', 'ул. Кораблестроителей', 'ул. Шевченко', 'Детская ул.',
    'Большой пр. В.О.', '17-я линия В.О.', 'Гаванская ул.', 'Малый пр. В.О.'
  ],
  centralnyy: [
    'ул. Рубинштейна', 'ул. Марата', 'Пушкинская ул.', 'ул. Жуковского',
    'ул. Восстания', 'Гончарная ул.', 'Кирочная ул.', 'Фурштатская ул.',
    'ул. Некрасова', 'Разъезжая ул.', 'Литейный пр.', 'Суворовский пр.',
    'ул. Чайковского', 'Захарьевская ул.', 'Греческий пр.', 'Лиговский пр.'
  ],
  admiralteyskiy: [
    'Загородный пр.', 'Лермонтовский пр.', 'наб. реки Фонтанки', 'Садовая ул.',
    'Измайловский пр.', '7-я Красноармейская ул.', 'ул. Егорова', 'Английский пр.',
    'Курляндская ул.', 'Рижский пр.', 'Дровяная ул.', 'Малодетскосельский пр.'
  ],
  moskovskiy: [
    'Московский пр.', 'Благодатная ул.', 'ул. Гастелло', 'Варшавская ул.',
    'Новоизмайловский пр.', 'ул. Типанова', 'Витебский пр.', 'Пулковская ул.',
    'Алтайская ул.', 'ул. Ленсовета', 'Звёздная ул.', 'пр. Космонавтов'
  ],
  vyborgskiy: [
    'пр. Энгельса', 'Придорожная аллея', 'ул. Жака Дюкло', 'Тихорецкий пр.',
    'Светлановский пр.', 'Северный пр.', 'пр. Луначарского', 'Костромской пр.',
    'Большой Сампсониевский пр.', 'ул. Есенина', 'Симонова ул.'
  ],
  kalininskiy: [
    'Гражданский пр.', 'ул. Ушинского', 'ул. Верности', 'пр. Науки',
    'Пискарёвский пр.', 'ул. Карпинского', 'ул. Бутлерова', 'Гжатская ул.',
    'Меншиковский пр.', 'Брюсовская ул.', 'Софьи Ковалевской ул.'
  ],
  primorskiy: [
    'Богатырский пр.', 'Комендантский пр.', 'ул. Савушкина', 'Приморский пр.',
    'Яхтенная ул.', 'ул. Оптиков', 'Долгоозёрная ул.', 'Шуваловский пр.',
    'Байконурская ул.', 'пр. Испытателей', 'Серебристый бул.', 'Ситцевая ул.'
  ],
  nevskiy: [
    'пр. Большевиков', 'Дальневосточный пр.', 'ул. Коллонтай', 'Искровский пр.',
    'Народная ул.', 'ул. Бабушкина', 'ул. Седова', 'ул. Тельмана',
    'Октябрьская наб.', 'ул. Крыленко', 'Новосёлов ул.'
  ],
  krasnogvardeyskiy: [
    'Заневский пр.', 'Новочеркасский пр.', 'Индустриальный пр.', 'ул. Передовиков',
    'Ржевская ул.', 'Большая Пороховская ул.', 'Среднеохтинский пр.', 'Якорная ул.',
    'Хасанская ул.', 'Отечественная ул.'
  ],
  frunzenskiy: [
    'Бухарестская ул.', 'Софийская ул.', 'ул. Турку', 'Будапештская ул.',
    'пр. Славы', 'Купчинская ул.', 'ул. Ярослава Гашека', 'ул. Белы Куна',
    'Салова ул.', 'ул. Димитрова', 'Малая Балканская ул.'
  ],
  kirovskiy: [
    'пр. Стачек', 'Кронштадтская ул.', 'ул. Маршала Говорова', 'Краснопутиловская ул.',
    'Автовская ул.', 'Севастопольская ул.', 'ул. Зенитчиков', 'Корабельная ул.',
    'Балтийская ул.', 'Оборонная ул.'
  ],
  krasnoselskiy: [
    'Ленинский пр.', 'ул. Партизана Германа', 'Петергофское шоссе', 'ул. Доблести',
    'Брестский бул.', 'ул. Тамбасова', 'ул. Пограничника Гарькавого', 'ул. Добровольцев'
  ],
  pushkinskiy: [
    'Пушкинская ул.', 'Школьная ул.', 'Валдайская ул.', 'Новгородский пр.',
    'Ленсоветовская ул.', 'Окружная ул.', 'Вишерская ул.'
  ],
  kolpinskiy: [
    'пр. Ленина', 'Тверская ул.', 'Заводской пр.', 'ул. Веры Слуцкой',
    'Пролетарская ул.', 'Металлургов ул.'
  ]
};

const FIRST_M = ['Андрей', 'Сергей', 'Дмитрий', 'Илья', 'Павел', 'Никита', 'Роман', 'Артём', 'Егор', 'Максим', 'Кирилл', 'Виктор', 'Олег', 'Тимур', 'Глеб'];
const FIRST_F = ['Анна', 'Мария', 'Елена', 'Ольга', 'Ирина', 'Наталья', 'Татьяна', 'Ксения', 'Дарья', 'Юлия', 'Светлана', 'Полина', 'Вера', 'Алиса', 'Нина'];
const PATR_M = ['Сергеевич', 'Андреевич', 'Петрович', 'Игоревич', 'Валерьевич', 'Николаевич', 'Дмитриевич', 'Александрович', 'Михайлович', 'Борисович'];
const PATR_F = ['Сергеевна', 'Андреевна', 'Петровна', 'Игоревна', 'Валерьевна', 'Николаевна', 'Дмитриевна', 'Александровна', 'Михайловна', 'Борисовна'];
const LAST = ['Кузнецов', 'Соколов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Зайцев', 'Павлов', 'Семёнов', 'Голубев', 'Виноградов', 'Богданов', 'Воробьёв', 'Фёдоров', 'Михайлов', 'Тарасов', 'Белов', 'Комаров', 'Орлов', 'Киселёв', 'Макаров', 'Андреев', 'Ковалёв', 'Ильин', 'Гусев', 'Титов', 'Кудрявцев', 'Баранов', 'Куликов'];

const TEACHER_NOTES = [
  'ведёт группы седьмой год',
  'мастер спорта, тренирует с 2016 года',
  'выпускница Герцена, работает с младшими',
  'кандидат в мастера спорта',
  'десять лет в профессии, из них шесть — с детьми',
  'ставил спектакли в любительском театре',
  'участник городских выставок',
  'судья второй категории',
  'преподаёт и взрослым, и детям',
  'закончил Политех, пришёл из инженеров',
  'работала в языковой школе за границей',
  'концертмейстер с двадцатилетним стажем'
];

const GROUP_NAMES = {
  robototehnika: ['Первый винт', 'Сборка', 'Контакт', 'Шестерёнка', 'Плата', 'Алгоритм', 'Стенд', 'Прототип', 'Отладка'],
  plavanie: ['Поплавок', 'Дорожка', 'Кроль', 'Вдох', 'Мелкая вода', 'Старт', 'Пятая дорожка'],
  muzyka: ['Первая октава', 'Мажор', 'Пауза', 'Терция', 'Аккорд', 'Тоника', 'Форте', 'Этюд'],
  yazyki: ['Первый диалог', 'Говорим', 'Разговорный', 'Present', 'Beginner', 'Диалог', 'Спикинг', 'Речь'],
  shahmaty: ['Дебют', 'Ферзевый гамбит', 'Ладья', 'Эндшпиль', 'Вилка', 'Рокировка', 'Тактика', 'Пешка'],
  risovanie: ['Натюрморт', 'Светотень', 'Гризайль', 'Набросок', 'Формат А2', 'Композиция', 'Перспектива'],
  edinoborstva: ['Первый пояс', 'Стойка', 'Татами', 'Захват', 'Бросок', 'Разминка', 'Второй круг'],
  tancy: ['Первая позиция', 'Связка', 'Партер', 'Плие', 'Ритм', 'Восьмёрка', 'Постановка'],
  teatr: ['Этюд', 'Первая роль', 'Реплика', 'Мизансцена', 'Читка', 'Сцена', 'Антракт']
};

/* ── геометрия ───────────────────────────────────────────────────────────── */

// смещение точки на dx метров на восток и dy метров на север
function offset(lat, lon, dxMeters, dyMeters) {
  const dLat = dyMeters / 111320;
  const dLon = dxMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ── даты ────────────────────────────────────────────────────────────────── */

const NOW = new Date();

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

const iso = (d) => d.toISOString().slice(0, 10);

// Набор привязан ко дню сборки: часть групп уже набирает, часть стартует скоро,
// часть — в следующем полугодии.
function intakeDate() {
  const bucket = weighted([['running', 45], ['soon', 40], ['later', 15]]);
  if (bucket === 'running') return iso(addDays(NOW, -int(3, 55)));
  if (bucket === 'soon') return iso(addDays(NOW, int(1, 45)));
  return iso(addDays(NOW, int(60, 130)));
}

/* ── сборка каталога ─────────────────────────────────────────────────────── */

const geo = JSON.parse(readFileSync(join(ROOT, 'data', 'geo.json'), 'utf8'));
const stationById = new Map(geo.stations.map((s) => [s.id, s]));
const districtById = new Map(geo.districts.map((d) => [d.id, d]));
const stationsByDistrict = new Map();
for (const st of geo.stations) {
  if (!stationsByDistrict.has(st.district)) stationsByDistrict.set(st.district, []);
  stationsByDistrict.get(st.district).push(st);
}

// Районы без метро: центр района задан вручную, ближайшая станция ищется по прямой.
const METROLESS = {
  krasnoselskiy: { lat: 59.8420, lon: 30.1720 },
  kolpinskiy: { lat: 59.7500, lon: 30.5900 },
  pushkinskiy: { lat: 59.7250, lon: 30.4100 }
};

const BRANCH_COUNT = 72;

// Бассейн физически возможен не везде: спорткомплексы стоят точечно.
const POOL_DISTRICTS = new Set(['moskovskiy', 'primorskiy', 'nevskiy', 'kirovskiy', 'vyborgskiy', 'frunzenskiy', 'petrogradskiy', 'vasileostrovskiy']);

/* организации */

const orgNames = shuffle(ORG_WORDS).slice(0, 46);
const orgs = orgNames.map((word, i) => {
  const kind = pick(ORG_KINDS);
  return {
    id: `o${String(i + 1).padStart(2, '0')}`,
    name: `${kind} «${word}»`,
    shortName: word
  };
});

/* филиалы */

const districtPool = [];
for (const d of geo.districts) districtPool.push([d.id, d.weight]);

const branches = [];
const usedAddresses = new Set();

for (let i = 0; i < BRANCH_COUNT; i++) {
  const districtId = weighted(districtPool);
  const district = districtById.get(districtId);
  const stations = stationsByDistrict.get(districtId);

  let lat;
  let lon;
  let station;

  if (stations && stations.length) {
    station = pick(stations);
    // Филиалы жмутся к станциям: 120–900 м от вестибюля.
    const angle = rnd() * Math.PI * 2;
    const dist = 120 + rnd() * 780;
    [lat, lon] = offset(station.lat, station.lon, Math.cos(angle) * dist, Math.sin(angle) * dist);
  } else {
    const center = METROLESS[districtId];
    const angle = rnd() * Math.PI * 2;
    const dist = 300 + rnd() * 2600;
    [lat, lon] = offset(center.lat, center.lon, Math.cos(angle) * dist, Math.sin(angle) * dist);
  }

  // Ближайшая станция считается честно по прямой, а не назначается.
  let nearest = null;
  let nearestDist = Infinity;
  for (const st of geo.stations) {
    const d = haversine(lat, lon, st.lat, st.lon);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = st;
    }
  }

  const town = districtId === 'kolpinskiy' ? 'Колпино, ' : districtId === 'pushkinskiy' ? 'Шушары, ' : '';
  let address;
  do {
    address = `${town}${pick(STREETS[districtId])}, ${int(1, 84)}`;
  } while (usedAddresses.has(address));
  usedAddresses.add(address);

  branches.push({
    id: `b${String(i + 1).padStart(3, '0')}`,
    orgId: null,
    address,
    districtId,
    districtName: district.name,
    stationId: nearest.id,
    stationName: nearest.name,
    metroDistance: Math.round(nearestDist),
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    hasPool: false
  });
}

// Организации получают филиалы: у большинства один, у нескольких — до четырёх.
{
  const queue = shuffle(branches.map((b) => b.id));
  const orgQueue = shuffle(orgs.map((o) => o.id));
  let oi = 0;
  while (queue.length) {
    const orgId = orgQueue[oi % orgQueue.length];
    const take = oi < orgs.length ? weighted([[1, 60], [2, 25], [3, 10], [4, 5]]) : 1;
    for (let k = 0; k < take && queue.length; k++) {
      const bid = queue.pop();
      branches.find((b) => b.id === bid).orgId = orgId;
    }
    oi++;
  }
}

/* бассейны */

{
  const candidates = branches.filter((b) => POOL_DISTRICTS.has(b.districtId));
  for (const b of shuffle(candidates).slice(0, 9)) b.hasPool = true;
}

/* специализация филиалов */

const dirById = new Map(DIRECTIONS.map((d) => [d.id, d]));

// Сколько филиалов ведёт каждое направление — по долям, а не случайным
// броском на каждый филиал: иначе театр обгоняет художественную школу.
{
  const land = DIRECTIONS.filter((d) => !d.needsPool);
  const totalShare = land.reduce((s, d) => s + d.share, 0);
  const wanted = branches.map(() => weighted([[1, 68], [2, 28], [3, 4]]));
  const slots = wanted.reduce((s, n) => s + n, 0);
  const quota = new Map(land.map((d) => [d.id, Math.max(2, Math.round((d.share / totalShare) * slots))]));

  // Направления лежат по городу не одинаково: шахматы, языки и театр живут
  // в центре при домах творчества, робототехника и единоборства — в районах
  // с новыми школами и спортзалами.
  const CENTER = new Set(['centralnyy', 'admiralteyskiy', 'petrogradskiy', 'vasileostrovskiy']);
  const affinity = (dir, districtId) => {
    if (dir.affinity === 'center') return CENTER.has(districtId) ? 2.4 : 0.6;
    if (dir.affinity === 'outer') return CENTER.has(districtId) ? 0.5 : 1.6;
    return 1;
  };

  branches.forEach((b, i) => {
    const specs = new Set();
    if (b.hasPool) specs.add('plavanie');
    for (let k = 0; k < wanted[i]; k++) {
      const available = land.filter((d) => quota.get(d.id) > 0 && !specs.has(d.id));
      if (!available.length) break;
      const chosen = weighted(available.map((d) => [d.id, quota.get(d.id) * affinity(d, b.districtId)]));
      quota.set(chosen, quota.get(chosen) - 1);
      specs.add(chosen);
    }
    b.specs = [...specs];
  });
}

/* группы */

const WEEKDAY_STARTS = [
  [960, 6], [990, 8], [1020, 16], [1035, 5], [1050, 14], [1065, 6],
  [1080, 16], [1095, 5], [1110, 12], [1140, 8], [1170, 4]
]; // 16:00 … 19:30, с «некруглыми» 17:15 / 17:45 / 18:15

const WEEKEND_STARTS = [
  [510, 4], [540, 10], [570, 9], [600, 14], [630, 10], [660, 11],
  [690, 8], [720, 7], [780, 6], [840, 5]
]; // 08:30 … 14:00

const WEEKDAY_PATTERNS = [
  [[1, 4], 22], [[2, 5], 20], [[1, 3], 10], [[3, 5], 8],
  [[2, 4], 10], [[1, 3, 5], 8], [[2, 4, 6], 6], [[3], 6], [[2], 5], [[4], 5]
];

const WEEKEND_PATTERNS = [[[6], 30], [[7], 14], [[6, 7], 16], [[6, 3], 12], [[7, 2], 8]];

const LEVELS = [
  { id: 'start', name: 'с нуля' },
  { id: 'continue', name: 'продолжающие' }
];

const groups = [];
let gid = 0;

const priceFactor = (districtId) => {
  const w = districtById.get(districtId).weight;
  return 0.85 + (w / 12) * 0.35; // центр дороже окраин примерно на треть
};

for (const b of branches) {
  for (const dirId of b.specs) {
    const dir = dirById.get(dirId);
    // Специализированный филиал ведёт несколько параллельных групп одного
    // направления: разные возрастные срезы и разные уровни, диапазоны
    // намеренно пересекаются — так же, как в жизни.
    const count = weighted([[2, 46], [3, 32], [4, 15], [5, 6], [6, 1]]);
    const [spanFrom, spanTo] = dir.ageSpan;

    for (let k = 0; k < count; k++) {
      const width = weighted([[2, 18], [3, 26], [4, 24], [5, 18], [6, 10], [7, 4]]);
      const from = int(spanFrom, Math.max(spanFrom, spanTo - width));
      const to = Math.min(spanTo, from + width);

      const weekend = chance(dir.needsPool ? 0.4 : 0.3);
      const days = weekend ? weighted(WEEKEND_PATTERNS) : weighted(WEEKDAY_PATTERNS);
      const duration = pick(dir.duration);

      const lessons = days.map((day) => {
        const start = day >= 6 ? weighted(WEEKEND_STARTS) : weighted(WEEKDAY_STARTS);
        return { day, start, end: start + duration };
      });
      lessons.sort((x, y) => x.day - y.day || x.start - y.start);

      const base = int(dir.price[0], dir.price[1]);
      const priceMonth = Math.round((base * priceFactor(b.districtId)) / 50) * 50;
      const perWeek = lessons.length;
      const priceSingle = Math.round(priceMonth / (perWeek * 4.3) / 50) * 50 + int(0, 2) * 50;

      const female = chance(0.62);
      const teacherName = female
        ? `${pick(FIRST_F)} ${pick(PATR_F)}`
        : `${pick(FIRST_M)} ${pick(PATR_M)}`;

      const subtype = dir.subtypes ? pick(dir.subtypes) : null;
      const level = to - from <= 3 && chance(0.5) ? pick(LEVELS) : LEVELS[chance(0.55) ? 0 : 1];

      gid++;
      const id = `g${String(gid).padStart(3, '0')}`;
      const title = pick(GROUP_NAMES[dirId]);

      // Уникальность адресу даёт id в начале пути (/g/g042-…), поэтому слаг
      // может повторяться — суффиксы-номера в нём только мусорят.
      const slug = slugify(`${dir.slug}-${title}-${b.stationName}`);

      const hasTrial = chance(0.82);

      groups.push({
        id,
        slug,
        direction: dirId,
        subtype,
        title,
        orgId: b.orgId,
        branchId: b.id,
        ageFrom: from,
        ageTo: to,
        level: level.id,
        lessons,
        priceMonth,
        priceSingle,
        trial: { has: hasTrial, free: hasTrial ? chance(0.62) : false },
        teacher: {
          name: `${teacherName} ${female ? pick(LAST) + 'а' : pick(LAST)}`,
          note: pick(TEACHER_NOTES)
        },
        groupSize: weighted([[4, 6], [6, 18], [8, 26], [10, 22], [12, 16], [14, 8], [16, 4]]),
        intakeStart: intakeDate(),
        about: dir.about,
        brings: dir.brings
      });
    }
  }
}

/* ── ручные дополнения ───────────────────────────────────────────────────── */

// Генератор перезаписывает catalog.json на каждой сборке, поэтому править
// его руками бессмысленно. Всё, что добавлено вручную, живёт в extra.json
// и подмешивается здесь — так оно переживает перегенерацию.
let added = 0;
{
  const extraPath = join(ROOT, 'data', 'extra.json');
  if (existsSync(extraPath)) {
    const extra = JSON.parse(readFileSync(extraPath, 'utf8'));
    for (const o of extra.orgs || []) {
      if (!orgs.some((x) => x.id === o.id)) orgs.push(o);
    }
    for (const b of extra.branches || []) {
      if (!branches.some((x) => x.id === b.id)) branches.push(b);
    }
    for (const g of extra.groups || []) {
      if (groups.some((x) => x.id === g.id)) {
        console.warn(`extra.json: id ${g.id} уже занят, группа пропущена`);
        continue;
      }
      groups.push(g);
      added++;
    }
  }
}

/* ── запись ──────────────────────────────────────────────────────────────── */

for (const b of branches) delete b.specs;

const catalog = {
  meta: {
    demo: true,
    generatedAt: NOW.toISOString(),
    seed: SEED,
    counts: { groups: groups.length, branches: branches.length, orgs: orgs.length }
  },
  directions: DIRECTIONS.map((d) => ({
    id: d.id,
    name: d.name,
    short: d.short,
    genitive: d.genitive,
    slug: d.slug,
    subtypes: d.subtypes
  })),
  levels: LEVELS,
  orgs,
  branches,
  groups
};

writeFileSync(join(ROOT, 'data', 'catalog.json'), JSON.stringify(catalog), 'utf8');

const byDir = new Map();
for (const g of groups) byDir.set(g.direction, (byDir.get(g.direction) || 0) + 1);

console.log(`Каталог: ${groups.length} групп, ${branches.length} филиалов, ${orgs.length} организаций` + (added ? ` (из них ${added} добавлено вручную в extra.json)` : ''));
for (const d of DIRECTIONS) {
  console.log(`  ${d.name.padEnd(34, ' ')} ${String(byDir.get(d.id) || 0).padStart(3, ' ')}`);
}
