import type { ObjectId } from 'mongodb';
import { z } from 'zod';
import {
  ratesSourceSchema,
  RATES_SOURCE_LABELS,
  RATES_SOURCE_LABELS_GENITIVE,
} from '../currency/currency.types';

/** Путь конвертации цен Steam */
export const steamPathSchema = z.enum(['converter', 'steam', 'usd_bridge']);
export type SteamConversionPath = z.infer<typeof steamPathSchema>;

/** Путь конвертации цен Steam */
// примитивы вынесены, чтобы схема PATCH повторяла ограничения без .default() —
// иначе zod при частичном обновлении подставляет дефолты и затирает сохранённые поля
const steamRegionSchema = z.string().regex(/^[a-z]{2}$/, 'Код региона — две строчные буквы');
const steamTargetCurrencySchema = z.string().min(2).max(5).toUpperCase();
const steamExtraPercentSchema = z.coerce.number().min(0).max(50);

export const steamConversionSettingsSchema = z.object({
  /** Регион (cc) магазина Steam, в котором берём цены */
  region: steamRegionSchema,
  /** Валюта, в которую конвертируем цены */
  targetCurrency: steamTargetCurrencySchema,
  path: steamPathSchema,
  /** Источник курса для путей с конвертером — независимый от основного */
  ratesSource: ratesSourceSchema.default('openexchangerates'),
  /** Доп. процент сверх конвертации (комиссия банка/сервиса) */
  extraPercent: steamExtraPercentSchema.default(0),
});

export type SteamConversionSettings = z.infer<typeof steamConversionSettingsSchema>;

export const conversionSettingsSchema = z.object({
  ratesSource: ratesSourceSchema,
  steam: steamConversionSettingsSchema,
});

export type ConversionSettings = z.infer<typeof conversionSettingsSchema>;

/** PUT: частичное обновление, незатронутые поля сохраняются */
export const updateConversionSettingsSchema = z.object({
  ratesSource: ratesSourceSchema.optional(),
  steam: z
    .object({
      region: steamRegionSchema,
      targetCurrency: steamTargetCurrencySchema,
      path: steamPathSchema,
      ratesSource: ratesSourceSchema,
      extraPercent: steamExtraPercentSchema,
    })
    .partial()
    .optional(),
});

export type UpdateConversionSettings = z.infer<typeof updateConversionSettingsSchema>;

export const DEFAULT_CONVERSION_SETTINGS: ConversionSettings = {
  ratesSource: 'openexchangerates',
  steam: {
    region: 'kz',
    targetCurrency: 'RUB',
    path: 'converter',
    ratesSource: 'openexchangerates',
    extraPercent: 0,
  },
};

/** Человеческое описание пути конвертации Steam (для подписи в сообщениях и UI) */
export function describeSteamConversion(steam: {
  path: SteamConversionPath;
  ratesSource: ConversionSettings['steam']['ratesSource'];
}): string {
  switch (steam.path) {
    case 'converter':
      return `по курсу ${RATES_SOURCE_LABELS_GENITIVE[steam.ratesSource]}`;
    case 'steam':
      return 'по курсу Steam';
    case 'usd_bridge':
      return `Steam → USD → ${RATES_SOURCE_LABELS[steam.ratesSource]}`;
  }
}

export interface ConversionSettingsDocument {
  _id?: ObjectId;
  chatId: number;
  ratesSource: ConversionSettings['ratesSource'];
  steam: SteamConversionSettings;
  updatedAt?: Date;
}
