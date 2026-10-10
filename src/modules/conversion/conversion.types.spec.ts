import { describe, expect, it } from 'vitest';
import type { ConverterSource } from '../currency/currency.types';

// импорт тянет config, который требует NODE_ENV=development|production (vitest ставит test)
process.env.NODE_ENV = 'development';
const { DEFAULT_CONVERSION_SETTINGS, describeSteamConversion, updateConversionSettingsSchema } =
  await import('./conversion.types');

const steam = (ratesSource: ConverterSource, path: 'converter' | 'steam' | 'usd_bridge') => ({
  ratesSource,
  path,
});

describe('describeSteamConversion', () => {
  it('описывает все три пути по steam-источнику (не основному)', () => {
    expect(describeSteamConversion(steam('tbank', 'converter'))).toBe('по курсу Т-Банка');
    expect(describeSteamConversion(steam('cbrf', 'converter'))).toBe('по курсу ЦБ РФ');
    expect(describeSteamConversion(steam('openexchangerates', 'steam'))).toBe('по курсу Steam');
    expect(describeSteamConversion(steam('tbank', 'usd_bridge'))).toBe('Steam → USD → Т-Банк');
    expect(describeSteamConversion(steam('cbrf', 'usd_bridge'))).toBe('Steam → USD → ЦБ РФ');
  });

  it('дефолты: путь «всё по курсу конвертера», steam-источник независимый OXR', () => {
    expect(DEFAULT_CONVERSION_SETTINGS.steam.path).toBe('converter');
    expect(DEFAULT_CONVERSION_SETTINGS.steam.ratesSource).toBe('openexchangerates');
  });
});

describe('updateConversionSettingsSchema (PATCH)', () => {
  it('не подставляет дефолты в пропущенные steam-поля — иначе PATCH затирает сохранённое', () => {
    const result = updateConversionSettingsSchema.safeParse({ steam: { path: 'steam' } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.steam).toEqual({ path: 'steam' });
    expect(result.data.steam?.ratesSource).toBeUndefined();
    expect(result.data.steam?.extraPercent).toBeUndefined();
  });

  it('частичный steam-патч валидирует каждое поле по отдельности', () => {
    for (const patch of [
      { ratesSource: 'cbrf' },
      { steam: { region: 'ru' } },
      { steam: { targetCurrency: 'USD' } },
      { steam: { ratesSource: 'tbank' } },
      { steam: { extraPercent: 2.5 } },
    ]) {
      expect(updateConversionSettingsSchema.safeParse(patch).success).toBe(true);
    }
  });
});
