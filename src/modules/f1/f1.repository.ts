import type { Collection, Db, ObjectId } from 'mongodb';
import type { F1Calendar, F1SessionResult, F1StandingsSnapshot } from './f1.types';

// версия в ключе сбрасывает кэш календаря при изменении его структуры
const CALENDAR_KEY = (season: number): string => `calendar:v2:${season}`;

interface F1CacheDocument {
  _id?: ObjectId;
  key: string;
  kind: 'calendar' | 'sessionResult';
  value: F1Calendar | F1SessionResult;
  updatedAt: Date;
}

interface F1StandingsSnapshotDocument extends F1StandingsSnapshot {
  _id?: ObjectId;
}

interface F1DeliveryDocument {
  _id?: ObjectId;
  sessionId: string;
  chatId: number;
  sentAt: Date;
}

export class F1Repository {
  private readonly cache: Collection<F1CacheDocument>;
  private readonly snapshots: Collection<F1StandingsSnapshotDocument>;
  private readonly deliveries: Collection<F1DeliveryDocument>;

  constructor(db: Db) {
    this.cache = db.collection<F1CacheDocument>('f1Cache');
    this.snapshots = db.collection<F1StandingsSnapshotDocument>('f1StandingsSnapshots');
    this.deliveries = db.collection<F1DeliveryDocument>('f1Deliveries');
  }

  async ensureIndexes(): Promise<void> {
    await this.cache.createIndex({ key: 1 }, { unique: true });
    await this.snapshots.createIndex({ sessionId: 1 }, { unique: true });
    await this.snapshots.createIndex({ capturedAt: -1 });
    await this.deliveries.createIndex({ sessionId: 1, chatId: 1 }, { unique: true });
  }

  async getCalendar(season: number): Promise<{ value: F1Calendar; updatedAt: Date } | null> {
    const document = await this.cache.findOne({ key: CALENDAR_KEY(season) });
    if (!document || document.kind !== 'calendar') return null;
    return { value: document.value as F1Calendar, updatedAt: document.updatedAt };
  }

  /**
   * В межсезонье под ключом текущего года хранится календарь прошлого сезона
   * (новый ещё не начался) — иначе кэш никогда не попадает и каждый запрос ходит
   * в Jolpica дважды
   */
  async saveCalendar(calendar: F1Calendar, storageSeason = calendar.season): Promise<void> {
    await this.cache.updateOne(
      { key: CALENDAR_KEY(storageSeason) },
      { $set: { kind: 'calendar', value: calendar, updatedAt: new Date() } },
      { upsert: true },
    );
  }

  async getSessionResult(sessionId: string): Promise<F1SessionResult | null> {
    const document = await this.cache.findOne({ key: `session:${sessionId}` });
    if (!document || document.kind !== 'sessionResult') return null;
    return document.value as F1SessionResult;
  }

  async saveSessionResult(result: F1SessionResult, sessionId = result.session.id): Promise<void> {
    if (!result.entries.length) throw new Error('Нельзя сохранить пустой протокол Ф1');
    await this.cache.updateOne(
      { key: `session:${sessionId}` },
      { $set: { kind: 'sessionResult', value: result, updatedAt: new Date() } },
      { upsert: true },
    );
  }

  /** Протоколы практик остались в кэше со времён OpenF1 — источника больше нет */
  async deletePracticeResults(): Promise<number> {
    const { deletedCount } = await this.cache.deleteMany({
      kind: 'sessionResult',
      key: { $regex: /^session:\d+:\d+:practice/ },
    });
    return deletedCount;
  }

  getStandingsSnapshot(sessionId: string): Promise<F1StandingsSnapshot | null> {
    return this.snapshots.findOne({ sessionId });
  }

  /**
   * Сезон ограничиваем лексикографическим диапазоном sessionId `<season>:<round>:<kind>`:
   * без фильтра baseline первого этапа нового сезона возьмётся из финала прошлого
   */
  getLatestStandingsSnapshot(
    before?: string,
    season?: number,
  ): Promise<F1StandingsSnapshot | null> {
    return this.snapshots.findOne(
      {
        ...(before ? { capturedAt: { $lt: before } } : {}),
        ...(season !== undefined
          ? { sessionId: { $gte: `${season}:`, $lt: `${season + 1}:` } }
          : {}),
      },
      { sort: { capturedAt: -1 } },
    );
  }

  async saveStandingsSnapshot(snapshot: F1StandingsSnapshot): Promise<void> {
    await this.snapshots.updateOne(
      { sessionId: snapshot.sessionId },
      { $set: snapshot },
      { upsert: true },
    );
  }

  async hasDelivery(sessionId: string, chatId: number): Promise<boolean> {
    return Boolean(await this.deliveries.findOne({ sessionId, chatId }));
  }

  async markDelivery(sessionId: string, chatId: number): Promise<void> {
    await this.deliveries.updateOne(
      { sessionId, chatId },
      { $setOnInsert: { sentAt: new Date() } },
      { upsert: true },
    );
  }

  /** Снимает резерв, если отправка не удалась — ретрай сможет отправить заново */
  async releaseDelivery(sessionId: string, chatId: number): Promise<void> {
    await this.deliveries.deleteOne({ sessionId, chatId });
  }
}
