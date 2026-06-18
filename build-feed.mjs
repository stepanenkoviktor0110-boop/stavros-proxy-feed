// Proxy-feed для B24U — клиент Ставрос (stavros.ru), триал.
// Берёт исходный YML-фид, оставляет ТОЛЬКО товарную группу «Ножки и опоры мебельные»
// (categoryId 313 «Ножки неокрашенные» + 314 «Ножки с покрытием»), дедуплицирует
// варианты одного товара (размер/цвет/материал) до уникальных позиций, режет до 100
// (лимит триала), ВЫРЕЗАЕТ <price>/<currencyId> (бот настроен «деньги → менеджер»,
// у ножек цена скачет по варианту) и обогащает <description> разговорными синонимами.
//
// Подробности — references/04-feeds-and-widgets.md, SKILL.md Шаг 5.

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { writeFileSync, mkdirSync } from 'node:fs';

// ───── Конфигурация ─────────────────────────────────────────────────────────

const SOURCE_FEED_URL =
  process.env.SOURCE_FEED_URL ||
  'https://www.stavros.ru/bitrix/catalog_export/yandex_502613.php';

const OUT_PATH = 'public/feed.xml';

// Категории товарной группы «Ножки и опоры мебельные».
const KEEP_CATEGORY_IDS = new Set(['313', '314']);
const MAX_OFFERS = 100; // лимит триала B24U

// Синонимы — то, как пользователи спрашивают про ножки/опоры.
const LEG_SYNONYMS =
  'мебельная ножка опора ножки опоры для мебели стола столешницы дивана кресла ' +
  'комода тумбы шкафа кровати банкетки; неокрашенные под покраску заготовка либо ' +
  'с покрытием эмаль лак тонировка; материал массив бук дуб МДФ. ' +
  'Выдерживают вертикальную нагрузку не менее 100 кг.';

// ───── Утилиты ───────────────────────────────────────────────────────────────

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (proxy-feed)' } });
  if (!res.ok) throw new Error(`Source feed fetch failed: ${res.status}`);
  return res.text();
}

const catId = (offer) => String(offer['categoryId'] ?? '').trim();
const baseUrl = (offer) => String(offer['url'] ?? '').split('?')[0];

// Высота модели закодирована в description варианта как «(A=350 B=44 мм)».
// A — высота в мм; собираем по всем вариантам товара, чтобы бот видел весь ряд.
const heightOf = (offer) => {
  const m = String(offer['description'] ?? '').match(/A=(\d+)/);
  return m ? Number(m[1]) : null;
};

// Самодостаточный description: RAG отдаёт модели только <name>+<description>.
// Цену НЕ пишем (деньги → менеджер). Перечисляем ВСЕ доступные высоты (дедуп
// варианты-по-размеру схлопывает в одну запись — без этого бот «не видит» размеры).
// Ссылку даём — на карточку товара.
function enrichDescription(offer, heights) {
  const name = String(offer['name'] ?? '').trim();
  const url = baseUrl(offer);
  const card = name && url ? ` Карточка: [${name}](${url}).` : '';
  const h =
    heights && heights.size
      ? ` Доступные высоты (A), мм: ${[...heights].sort((a, b) => a - b).join(', ')}.`
      : '';
  return `${name}.${h} ${LEG_SYNONYMS}${card}`.replace(/\s+/g, ' ').trim();
}

// ───── Основной поток ────────────────────────────────────────────────────────

const xml = await fetchFeed(SOURCE_FEED_URL);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'offer' || name === 'category',
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressBooleanAttributes: false,
});

const feed = parser.parse(xml);
const shop = feed?.yml_catalog?.shop;
const allOffers = shop?.offers?.offer ?? [];

// 1. Оставить только ножки/опоры.
const legs = allOffers.filter((o) => KEEP_CATEGORY_IDS.has(catId(o)));

// 2. Дедуп вариантов до уникальных товаров (по базовому URL). available=true,
//    если хоть один вариант доступен. Высоты всех вариантов копим в Set.
const byProduct = new Map();
const heightsByProduct = new Map();
for (const o of legs) {
  const key = baseUrl(o);
  if (!byProduct.has(key)) {
    byProduct.set(key, o);
    heightsByProduct.set(key, new Set());
  } else if (String(o['@_available']) === 'true') {
    byProduct.get(key)['@_available'] = 'true';
  }
  const h = heightOf(o);
  if (h !== null) heightsByProduct.get(key).add(h);
}

// 3. Лимит триала.
const kept = [...byProduct.values()].slice(0, MAX_OFFERS);

// 4. Вырезать цену и параметры (Коллекции «Современная/Классика» — внутренние,
//    протекают в ответы бота и сбивают клиента), обогатить description, url без ?offer=.
for (const o of kept) {
  delete o['price'];
  delete o['currencyId'];
  delete o['oldprice'];
  delete o['param'];
  o['url'] = baseUrl(o);
  o['description'] = enrichDescription(o, heightsByProduct.get(baseUrl(o)));
}

// 5. Собрать минимальный shop: только наши категории + отобранные офферы.
shop.offers.offer = kept;
if (shop.categories?.category) {
  const keepCats = new Set(['158', '93', '313', '314']);
  shop.categories.category = shop.categories.category.filter((c) =>
    keepCats.has(String(c['@_id']))
  );
}

mkdirSync('public', { recursive: true });
writeFileSync(OUT_PATH, builder.build(feed), 'utf-8');

console.log(
  `Done. Legs in source: ${legs.length}, unique products: ${byProduct.size}, ` +
    `kept (cap ${MAX_OFFERS}): ${kept.length}. Written to ${OUT_PATH}`
);
