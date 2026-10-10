import { z } from 'zod';

export const ExchangeRatesSchema = z.object({
  base: z.string(),
  rates: z.record(z.string(), z.number()),
});

export type OpenExchangeRatesResponse = z.infer<typeof ExchangeRatesSchema>;

/** Источники, которые пользователь может выбрать в настройках конвертации */
export const CONVERTER_SOURCES = ['openexchangerates', 'cbrf', 'tbank'] as const;
export type ConverterSource = (typeof CONVERTER_SOURCES)[number];

/** Все источники курсов; steam используется только для конвертации цен Steam */
export const RATES_SOURCES = [...CONVERTER_SOURCES, 'steam'] as const;
export type RatesSource = (typeof RATES_SOURCES)[number];

export const RATES_SOURCE_LABELS: Record<RatesSource, string> = {
  openexchangerates: 'OpenExchangeRates',
  cbrf: 'ЦБ РФ',
  tbank: 'Т-Банк',
  steam: 'Steam',
};

/** Лейблы в родительном падеже («по курсу …») */
export const RATES_SOURCE_LABELS_GENITIVE: Record<RatesSource, string> = {
  openexchangerates: 'OpenExchangeRates',
  cbrf: 'ЦБ РФ',
  tbank: 'Т-Банка',
  steam: 'Steam',
};

export const ratesSourceSchema = z.enum(CONVERTER_SOURCES);

/** Таблица курсов относительно единой базы (USD): rate[X] = единиц X за 1 базовой */
export interface RatesTable {
  base: string;
  rates: Record<string, number>;
}

/** Направленные курсы Т-Банка к рублю: pairs[X] = { buy, sell } — курс банка по валюте X */
export interface TbankRates {
  base: 'RUB';
  pairs: Record<string, { buy: number; sell: number }>;
}

export type SourceRates = RatesTable | TbankRates;

// --- Схемы ответов внешних API ---

/** cbr-xml-daily.ru/daily_json.js */
export const CbrfDailySchema = z.object({
  Valute: z.record(
    z.string(),
    z.object({
      CharCode: z.string(),
      Nominal: z.coerce.number().positive(),
      Value: z.coerce.number().positive(),
    }),
  ),
});

export type CbrfDailyResponse = z.infer<typeof CbrfDailySchema>;

/** tinkoff.ru/api/v1/currency_rates */
export const TbankCurrencyRatesSchema = z.object({
  payload: z.object({
    rates: z.array(
      z.object({
        category: z.string(),
        fromCurrency: z.object({ name: z.string() }),
        toCurrency: z.object({ name: z.string() }),
        buy: z.coerce.number().positive(),
        sell: z.coerce.number().positive(),
      }),
    ),
  }),
});

export type TbankCurrencyRatesResponse = z.infer<typeof TbankCurrencyRatesSchema>;

/** store.steampowered.com/api/appdetails?filters=price_overview */
export const SteamAppPriceSchema = z.object({
  success: z.boolean(),
  // у f2p-приложений data — пустой массив, у платных price_overview может отсутствовать
  data: z
    .union([
      z.object({
        price_overview: z
          .object({
            currency: z.string(),
            initial: z.coerce.number().positive(),
          })
          .optional(),
      }),
      z.array(z.unknown()),
    ])
    .optional(),
});

/** steamcommunity.com/market/priceoverview */
export const SteamMarketPriceOverviewSchema = z.object({
  success: z.boolean(),
  lowest_price: z.string().optional(),
  median_price: z.string().optional(),
  volume: z.string().optional(),
});

/** Категория курсов Т-Банка, используемая для конвертации (карточные операции) */
export const TBANK_CATEGORY = 'DebitCardsOperations';

export const currencyParseSchema = z.object({
  amount: z.coerce.number().positive(),
  from: z.string().min(2).max(5).toUpperCase(),
  to: z.string().min(2).max(5).toUpperCase().default('RUB'),
});

export type CurrencyParseResult = z.infer<typeof currencyParseSchema>;
