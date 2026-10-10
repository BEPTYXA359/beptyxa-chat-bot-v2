import { config } from '../../shared/config';
import { logger } from '../../shared/logger';
import { fetchTbankJson } from './tbank.http';
import {
  CbrfDailySchema,
  ExchangeRatesSchema,
  RatesTable,
  SteamMarketPriceOverviewSchema,
  TBANK_CATEGORY,
  TbankCurrencyRatesSchema,
  TbankRates,
} from './currency.types';

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/** OpenExchangeRates: база USD приходит из API как есть */
export async function fetchOpenExchangeRates(): Promise<RatesTable> {
  const rawData = await fetchJson(
    `https://openexchangerates.org/api/latest.json?app_id=${config.EXCHANGE_APP_ID}`,
  );
  return ExchangeRatesSchema.parse(rawData);
}

/** ЦБ РФ через cbr-xml-daily.ru: рублёвые котировки приводим к базе USD */
export async function fetchCbrfRates(): Promise<RatesTable> {
  const rawData = await fetchJson('https://www.cbr-xml-daily.ru/daily_json.js');
  const { Valute } = CbrfDailySchema.parse(rawData);

  const usd = Valute.USD;
  if (!usd) throw new Error('В ответе ЦБ РФ нет доллара США');

  // rubPerUsd — рублей за доллар; rates должны быть «единиц валюты за 1 USD»
  const rubPerUsd = usd.Value / usd.Nominal;
  const rates: Record<string, number> = { RUB: rubPerUsd, USD: 1 };

  for (const valute of Object.values(Valute)) {
    if (valute.CharCode === 'USD') continue;
    const rubPerValute = valute.Value / valute.Nominal;
    rates[valute.CharCode] = rubPerUsd / rubPerValute;
  }

  return { base: 'USD', rates };
}

/** Т-Банк: направленные курсы к рублю по карточным операциям, без среднего */
export async function fetchTbankRates(): Promise<TbankRates> {
  const rawData = await fetchTbankJson('https://www.tinkoff.ru/api/v1/currency_rates');
  const { payload } = TbankCurrencyRatesSchema.parse(rawData);

  const pairs: TbankRates['pairs'] = {};
  for (const rate of payload.rates) {
    if (rate.category !== TBANK_CATEGORY) continue;
    if (rate.toCurrency.name !== 'RUB') continue;
    if (rate.buy >= rate.sell) continue; // защита от инвертированной котировки

    const code = rate.fromCurrency.name.toUpperCase();
    const existing = pairs[code];
    if (existing && existing.buy <= rate.buy) continue;

    pairs[code] = { buy: rate.buy, sell: rate.sell };
  }

  if (Object.keys(pairs).length === 0) {
    throw new Error(`В ответе Т-Банка нет категории ${TBANK_CATEGORY}`);
  }

  return { base: 'RUB', pairs };
}

// --- Курсы Steam из торговой площадки ---

/**
 * Ликвидные предметы CS2: их цены в разных валютах площадки почти арбитражны,
 * поэтому соотношение цен ≈ реальный FX-курс Steam (совпадает с конвертацией кошелька).
 */
const STEAM_MARKET_ITEMS = ['AK-47 | Redline (Field-Tested)', 'AWP | Asiimov (Field-Tested)'];

/** Валютные ID priceoverview (проверено живыми запросами), код → ID */
const MARKET_CURRENCY_IDS: Record<string, number> = {
  USD: 1,
  GBP: 2,
  EUR: 3,
  CHF: 4,
  RUB: 5,
  PLN: 6,
  BRL: 7,
  JPY: 8,
  NOK: 9,
  IDR: 10,
  MYR: 11,
  PHP: 12,
  SGD: 13,
  THB: 14,
  VND: 15,
  KRW: 16,
  UAH: 18,
  MXN: 19,
  CAD: 20,
  AUD: 21,
  NZD: 22,
  CNY: 23,
  INR: 24,
  CLP: 25,
  PEN: 26,
  COP: 27,
  ZAR: 28,
  HKD: 29,
  TWD: 30,
  SAR: 31,
  AED: 32,
  ILS: 35,
  KZT: 37,
  KWD: 38,
  QAR: 39,
  CRC: 40,
  UYU: 41,
};

const MARKET_REQUEST_DELAY_MS = 3000;
const MARKET_REQUEST_TIMEOUT_MS = 15_000;
const MARKET_RATE_LIMIT_RETRY_MS = 15_000;
const MARKET_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

let lastMarketRequestTime = 0;

async function marketThrottledFetch(url: string): Promise<unknown> {
  // при 429 Steam просит подождать — один повторный заход после паузы
  for (let attempt = 0; attempt < 2; attempt++) {
    const elapsed = Date.now() - lastMarketRequestTime;
    if (elapsed < MARKET_REQUEST_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, MARKET_REQUEST_DELAY_MS - elapsed));
    }
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, MARKET_RATE_LIMIT_RETRY_MS));
    }
    lastMarketRequestTime = Date.now();
    const response = await fetch(url, {
      headers: { 'User-Agent': MARKET_USER_AGENT },
      // Steam при троттлинге может тарпитить соединение на минуты — обрываем
      signal: AbortSignal.timeout(MARKET_REQUEST_TIMEOUT_MS),
    });
    if (response.status === 429 && attempt === 0) continue;
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }
  throw new Error('HTTP error! status: 429');
}

/**
 * Курсы Steam из торговой площадки: rate[X] = price_X / price_USD, база USD.
 * Проверено на живых данных: KZT 14 773₸ / $32.78 = 450.8₸/$ — совпадает
 * с реальной конвертацией кошелька Steam (450.7₸/$).
 *
 * Все валюты одного прохода берутся из ОДНОГО предмета (у разных предметов
 * соотношения свои); второй предмет только добирает пропуски по своим ценам.
 */
export async function fetchSteamMarketRates(): Promise<RatesTable> {
  const mergedRates: Record<string, number> = {};

  for (const itemName of STEAM_MARKET_ITEMS) {
    const itemPrices = await fetchItemPrices(itemName);
    if (!itemPrices || !itemPrices.USD || itemPrices.USD <= 0) continue;

    for (const [code, price] of Object.entries(itemPrices)) {
      if (price > 0 && mergedRates[code] === undefined) {
        mergedRates[code] = price / itemPrices.USD;
      }
    }
  }

  if (Object.keys(mergedRates).length < 4) {
    throw new Error('Торговая площадка Steam не дала достаточно валют для курсов');
  }

  return { base: 'USD', rates: mergedRates };
}

/** Цены одного предмета во всех валютах площадки: код → цена */
async function fetchItemPrices(itemName: string): Promise<Record<string, number> | null> {
  const prices: Record<string, number> = {};

  for (const [code, currencyId] of Object.entries(MARKET_CURRENCY_IDS)) {
    try {
      const url =
        'https://steamcommunity.com/market/priceoverview/?appid=730' +
        `&market_hash_name=${encodeURIComponent(itemName)}&currency=${currencyId}`;
      const overview = SteamMarketPriceOverviewSchema.parse(await marketThrottledFetch(url));
      if (!overview.success || !overview.lowest_price) continue;
      const price = parseMarketPrice(overview.lowest_price);
      if (Number.isFinite(price) && price > 0) prices[code] = price;
    } catch (error) {
      logger.warn(
        { err: error, code, itemName },
        'Ошибка при получении цены предмета в Steam Market',
      );
    }
  }

  if (Object.keys(prices).length === 0) {
    logger.warn({ itemName }, 'Предмет не дал ни одной цены на площадке Steam');
    return null;
  }
  return prices;
}

/**
 * «14 773₸» → 14773; «29,30€» → 29.3; «₡15.085» → 15085; «₡14.951,28» → 14951.28; «$32.78» → 32.78.
 * Из двух разделителей десятичный — последний; одиночный разделитель с тремя
 * цифрами после — разделитель тысяч, с одной-двумя — десятичный.
 */
export function parseMarketPrice(raw: string): number {
  let s = raw.replace(/[^\d.,]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const [intPart, decPart] = s.split(sep);
    if (decPart !== undefined) {
      if (decPart.length === 3) s = intPart + decPart;
      else s = `${intPart}.${decPart}`;
    }
  }
  return Number.parseFloat(s);
}
