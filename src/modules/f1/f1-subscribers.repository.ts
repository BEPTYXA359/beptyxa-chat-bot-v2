import type { Collection, Db } from 'mongodb';
import {
  DEFAULT_F1_SETTINGS,
  type F1Settings,
  type F1SubscriberDocument,
  type UpdateF1Settings,
} from './f1.types';

export class F1SubscribersRepository {
  private readonly collection: Collection<F1SubscriberDocument>;

  constructor(db: Db) {
    this.collection = db.collection<F1SubscriberDocument>('f1Subscribers');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ chatId: 1 }, { unique: true });
  }

  getByChat(chatId: number): Promise<F1SubscriberDocument | null> {
    return this.collection.findOne({ chatId });
  }

  getEnabled(): Promise<F1SubscriberDocument[]> {
    return this.collection.find({ enabled: true }).toArray();
  }

  async upsert(chatId: number, patch: UpdateF1Settings): Promise<F1SubscriberDocument | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['enabled', 'fullProtocols', 'reminders'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    const setOnInsert: Record<string, unknown> = { chatId };
    for (const key of Object.keys(DEFAULT_F1_SETTINGS) as Array<keyof F1Settings>) {
      if (patch[key] === undefined) setOnInsert[key] = DEFAULT_F1_SETTINGS[key];
    }
    return this.collection.findOneAndUpdate(
      { chatId },
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true, returnDocument: 'after' },
    );
  }
}
