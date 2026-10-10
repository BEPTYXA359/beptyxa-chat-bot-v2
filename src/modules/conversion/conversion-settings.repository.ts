import { Collection, Db } from 'mongodb';
import { ConversionSettingsDocument, UpdateConversionSettings } from './conversion.types';

export class ConversionSettingsRepository {
  private readonly collection: Collection<ConversionSettingsDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ConversionSettingsDocument>('conversionSettings');
  }

  public async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ chatId: 1 }, { unique: true });
  }

  public async getByChat(chatId: number): Promise<ConversionSettingsDocument | null> {
    return this.collection.findOne({ chatId });
  }

  /** Частичное обновление: steam-секция мержится по точечным путям, а не перезаписывается */
  public async upsert(
    chatId: number,
    patch: UpdateConversionSettings,
  ): Promise<ConversionSettingsDocument | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.ratesSource !== undefined) set.ratesSource = patch.ratesSource;
    if (patch.steam?.region !== undefined) set['steam.region'] = patch.steam.region;
    if (patch.steam?.targetCurrency !== undefined) {
      set['steam.targetCurrency'] = patch.steam.targetCurrency;
    }
    if (patch.steam?.path !== undefined) set['steam.path'] = patch.steam.path;
    if (patch.steam?.ratesSource !== undefined) {
      set['steam.ratesSource'] = patch.steam.ratesSource;
    }
    if (patch.steam?.extraPercent !== undefined) {
      set['steam.extraPercent'] = patch.steam.extraPercent;
    }

    const result = await this.collection.findOneAndUpdate(
      { chatId },
      { $set: set },
      { upsert: true, returnDocument: 'after' },
    );
    return result ?? null;
  }
}
