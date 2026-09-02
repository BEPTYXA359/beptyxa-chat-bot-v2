import { Collection, Db } from 'mongodb';
import { SubscriptionSettingsDocument } from './subscription.types';

export class SubscriptionSettingsRepository {
  private readonly collection: Collection<SubscriptionSettingsDocument>;

  constructor(db: Db) {
    this.collection = db.collection<SubscriptionSettingsDocument>('subscriptionSettings');
  }

  public async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ chatId: 1 }, { unique: true });
  }

  public async getByChat(chatId: number): Promise<SubscriptionSettingsDocument | null> {
    return this.collection.findOne({ chatId });
  }

  public async upsertBaseCurrency(
    chatId: number,
    baseCurrency: string,
  ): Promise<SubscriptionSettingsDocument> {
    const result = await this.collection.findOneAndUpdate(
      { chatId },
      { $set: { baseCurrency, updatedAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    return result ?? { chatId, baseCurrency };
  }
}
