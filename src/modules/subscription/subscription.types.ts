import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { isRealDateString } from '../../shared/utils/timezone.util';

export const SUBSCRIPTION_PERIODS = ['week', 'month', 'quarter', 'half_year', 'year'] as const;
export type SubscriptionPeriod = (typeof SUBSCRIPTION_PERIODS)[number];

export const SUBSCRIPTION_REMIND_DAYS_BEFORE = [1, 3, 7] as const;
export type SubscriptionRemindDaysBefore = (typeof SUBSCRIPTION_REMIND_DAYS_BEFORE)[number];

export type SubscriptionStatus = 'active' | 'paused';

export const DEFAULT_SUBSCRIPTION_CURRENCY = 'RUB';

const DATE_STRING_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const createSubscriptionSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(100, 'Название слишком длинное'),
  service: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(100).optional(),
  ),
  cost: z.coerce
    .number()
    .positive('Стоимость должна быть больше нуля')
    .max(10_000_000, 'Слишком большая стоимость'),
  currency: z
    .string()
    .trim()
    .length(3, 'Код валюты — 3 буквы')
    .transform((value) => value.toUpperCase()),
  period: z.enum(SUBSCRIPTION_PERIODS, 'Выберите период оплаты'),
  nextPaymentDate: z
    .string()
    .regex(DATE_STRING_REGEX, 'Дата в формате ГГГГ-ММ-ДД')
    .refine(isRealDateString, 'Такой даты не существует'),
  remindDaysBefore: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(1),
  notificationsEnabled: z.boolean().default(true),
  status: z.enum(['active', 'paused']).default('active'),
  color: z
    .string()
    .regex(COLOR_REGEX, 'Цвет в формате #RRGGBB')
    .transform((value) => value.toUpperCase())
    .optional(),
});

export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;

export interface SubscriptionDocument {
  _id?: ObjectId;
  chatId: number;
  name: string;
  service?: string;
  cost: number;
  currency: string;
  period: SubscriptionPeriod;
  nextPaymentDate: string;
  remindDaysBefore: SubscriptionRemindDaysBefore;
  notificationsEnabled: boolean;
  status: SubscriptionStatus;
  color?: string;
  createdAt: Date;
  updatedAt?: Date;
  createdBy: number;
  creatorFirstName: string;
  creatorUsername?: string;
}

export const subscriptionSettingsSchema = z.object({
  baseCurrency: z
    .string()
    .trim()
    .length(3, 'Код валюты — 3 буквы')
    .transform((value) => value.toUpperCase()),
});

export type SubscriptionSettingsDto = z.infer<typeof subscriptionSettingsSchema>;

export interface SubscriptionSettingsDocument {
  _id?: ObjectId;
  chatId: number;
  baseCurrency: string;
  updatedAt?: Date;
}
