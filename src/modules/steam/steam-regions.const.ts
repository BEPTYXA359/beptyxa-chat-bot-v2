/**
 * Регионы (cc) магазина Steam и их валюты. Список используется для:
 *  - запроса regional-цен при выводе курсов Steam (currency.providers.ts);
 *  - определения валюты цены при разборе appdetails/IStoreBrowse (steam.service.ts).
 * TR и AR с 2024 года возвращают цены в USD.
 */
export const STEAM_REGION_CURRENCY: Record<string, string> = {
  us: 'USD',
  gb: 'GBP',
  // cc=eu appdetails не понимает и отдаёт USD-фолбэк — зона евро живёт по кодам стран
  de: 'EUR',
  ru: 'RUB',
  kz: 'KZT',
  ua: 'UAH',
  az: 'AZN',
  am: 'AMD',
  ge: 'GEL',
  md: 'MDL',
  kg: 'KGS',
  uz: 'UZS',
  tr: 'USD',
  ar: 'USD',
  br: 'BRL',
  cl: 'CLP',
  co: 'COP',
  mx: 'MXN',
  pe: 'PEN',
  uy: 'UYU',
  hn: 'HNL',
  cr: 'CRC',
  ca: 'CAD',
  no: 'NOK',
  ch: 'CHF',
  pl: 'PLN',
  il: 'ILS',
  za: 'ZAR',
  sa: 'SAR',
  ae: 'AED',
  qa: 'QAR',
  kw: 'KWD',
  lb: 'USD',
  in: 'INR',
  id: 'IDR',
  my: 'MYR',
  ph: 'PHP',
  sg: 'SGD',
  th: 'THB',
  vn: 'VND',
  cn: 'CNY',
  hk: 'HKD',
  tw: 'TWD',
  jp: 'JPY',
  kr: 'KRW',
  au: 'AUD',
  nz: 'NZD',
};

export const STEAM_REGIONS = Object.keys(STEAM_REGION_CURRENCY);

/** Валюты наших Steam-регионов — ровно их содержит steam-таблица курсов */
export const STEAM_CURRENCIES = [...new Set(Object.values(STEAM_REGION_CURRENCY))];

/** Оставляет в таблице курсов только валюты наших регионов */
export function filterSteamCurrencies(rates: Record<string, number>): Record<string, number> {
  const allowed = new Set(STEAM_CURRENCIES);
  return Object.fromEntries(Object.entries(rates).filter(([code]) => allowed.has(code)));
}
