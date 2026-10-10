import { ConversionSettingsRepository } from './conversion-settings.repository';
import {
  ConversionSettings,
  DEFAULT_CONVERSION_SETTINGS,
  UpdateConversionSettings,
} from './conversion.types';

export class ConversionSettingsService {
  constructor(private readonly repository: ConversionSettingsRepository) {}

  public async getSettings(chatId: number): Promise<ConversionSettings> {
    const doc = await this.repository.getByChat(chatId);
    if (!doc) {
      return structuredClone(DEFAULT_CONVERSION_SETTINGS);
    }

    return {
      ratesSource: doc.ratesSource ?? DEFAULT_CONVERSION_SETTINGS.ratesSource,
      steam: {
        region: doc.steam?.region ?? DEFAULT_CONVERSION_SETTINGS.steam.region,
        targetCurrency:
          doc.steam?.targetCurrency ?? DEFAULT_CONVERSION_SETTINGS.steam.targetCurrency,
        path: doc.steam?.path ?? DEFAULT_CONVERSION_SETTINGS.steam.path,
        ratesSource: doc.steam?.ratesSource ?? DEFAULT_CONVERSION_SETTINGS.steam.ratesSource,
        extraPercent: doc.steam?.extraPercent ?? DEFAULT_CONVERSION_SETTINGS.steam.extraPercent,
      },
    };
  }

  /** Источник курсов для конвертации (без steam-блока) */
  public async resolveRatesSource(chatId: number): Promise<ConversionSettings['ratesSource']> {
    return (await this.getSettings(chatId)).ratesSource;
  }

  public async update(
    chatId: number,
    patch: UpdateConversionSettings,
  ): Promise<ConversionSettings> {
    await this.repository.upsert(chatId, patch);
    return this.getSettings(chatId);
  }
}
