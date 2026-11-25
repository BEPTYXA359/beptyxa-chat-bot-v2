import { describe, expect, it } from 'vitest';
import { DEFAULT_F1_SETTINGS, f1SettingsSchema, updateF1SettingsSchema } from './f1.types';

describe('настройки Ф1', () => {
  it('подставляет все значения по умолчанию для новой подписки', () => {
    expect(f1SettingsSchema.parse({})).toEqual(DEFAULT_F1_SETTINGS);
  });

  it('не подставляет дефолты в частичное обновление', () => {
    expect(updateF1SettingsSchema.parse({ fullProtocols: true })).toEqual({ fullProtocols: true });
  });

  it('сортирует интервалы напоминаний', () => {
    expect(updateF1SettingsSchema.parse({ reminders: [60, 5, 30] })).toEqual({
      reminders: [5, 30, 60],
    });
  });

  it.each([[0], [-5], [1441], [1.5], [5, 5]])(
    'отклоняет некорректные интервалы: %j',
    (reminders) => {
      expect(updateF1SettingsSchema.safeParse({ reminders }).success).toBe(false);
    },
  );

  it('отклоняет больше десяти интервалов', () => {
    expect(
      updateF1SettingsSchema.safeParse({ reminders: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }).success,
    ).toBe(false);
  });
});
