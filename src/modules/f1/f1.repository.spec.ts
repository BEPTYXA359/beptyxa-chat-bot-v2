import { describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { F1Repository } from './f1.repository';
import { F1SubscribersRepository } from './f1-subscribers.repository';
import { DEFAULT_F1_SETTINGS, type F1Calendar, type F1SessionResult } from './f1.types';

const calendar: F1Calendar = { season: 2026, rounds: [] };
const result = {
  publishedAt: '2026-01-01T00:00:00.000Z',
  entries: [{ position: 1 } as F1SessionResult['entries'][number]],
} as F1SessionResult;

describe('F1Repository', () => {
  const createRepository = () => {
    const cache = {
      createIndex: vi.fn().mockResolvedValue('key_1'),
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    };
    const snapshots = {
      createIndex: vi.fn().mockResolvedValue('sessionId_1'),
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const deliveries = {
      createIndex: vi.fn().mockResolvedValue('sessionId_1_chatId_1'),
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({}),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const collections = {
      f1Cache: cache,
      f1StandingsSnapshots: snapshots,
      f1Deliveries: deliveries,
    };
    const db = {
      collection: vi.fn((name: keyof typeof collections) => collections[name]),
    } as unknown as Db;
    return { repository: new F1Repository(db), cache, snapshots, deliveries };
  };

  it('создаёт уникальные индексы без TTL для постоянного кэша', async () => {
    const { repository, cache, snapshots, deliveries } = createRepository();
    await repository.ensureIndexes();

    expect(cache.createIndex).toHaveBeenCalledWith({ key: 1 }, { unique: true });
    expect(snapshots.createIndex).toHaveBeenCalledWith({ sessionId: 1 }, { unique: true });
    expect(snapshots.createIndex).toHaveBeenCalledWith({ capturedAt: -1 });
    expect(deliveries.createIndex).toHaveBeenCalledWith(
      { sessionId: 1, chatId: 1 },
      { unique: true },
    );
    expect(cache.createIndex).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expireAfterSeconds: expect.anything() }),
    );
  });

  it('сохраняет календарь по ключу сезона и протокол через upsert', async () => {
    const { repository, cache } = createRepository();
    await repository.saveCalendar(calendar);
    await repository.saveCalendar(calendar, 2027);
    await repository.saveSessionResult(result, '2026:19:race');

    expect(cache.updateOne).toHaveBeenNthCalledWith(
      1,
      // версия в ключе сбрасывает кэш календаря после изменения его структуры
      { key: 'calendar:v2:2026' },
      { $set: { kind: 'calendar', value: calendar, updatedAt: expect.any(Date) } },
      { upsert: true },
    );
    expect(cache.updateOne).toHaveBeenNthCalledWith(
      2,
      // в межсезонье прошлогодний календарь лежит под ключом текущего года
      { key: 'calendar:v2:2027' },
      { $set: { kind: 'calendar', value: calendar, updatedAt: expect.any(Date) } },
      { upsert: true },
    );
    expect(cache.updateOne).toHaveBeenNthCalledWith(
      3,
      { key: 'session:2026:19:race' },
      { $set: { kind: 'sessionResult', value: result, updatedAt: expect.any(Date) } },
      { upsert: true },
    );
  });

  it('ищет предыдущий снапшот раньше указанного времени и в рамках сезона', async () => {
    const { repository, snapshots } = createRepository();
    await repository.getLatestStandingsSnapshot('2026-03-14T08:00:00.000Z');
    await repository.getLatestStandingsSnapshot('2026-03-14T08:00:00.000Z', 2026);
    expect(snapshots.findOne).toHaveBeenNthCalledWith(
      1,
      { capturedAt: { $lt: '2026-03-14T08:00:00.000Z' } },
      { sort: { capturedAt: -1 } },
    );
    // диапазон sessionId держит baseline внутри сезона
    expect(snapshots.findOne).toHaveBeenNthCalledWith(
      2,
      {
        capturedAt: { $lt: '2026-03-14T08:00:00.000Z' },
        sessionId: { $gte: '2026:', $lt: '2027:' },
      },
      { sort: { capturedAt: -1 } },
    );
  });

  it('атомарно отмечает уникальную доставку в чат', async () => {
    const { repository, deliveries } = createRepository();
    deliveries.findOne.mockResolvedValue({ sentAt: new Date() });
    await expect(repository.hasDelivery('2026:19:race', 123)).resolves.toBe(true);
    await repository.markDelivery('2026:19:race', 123);
    expect(deliveries.updateOne).toHaveBeenCalledWith(
      { sessionId: '2026:19:race', chatId: 123 },
      { $setOnInsert: { sentAt: expect.any(Date) } },
      { upsert: true },
    );
  });

  it('снимает резерв доставки, если отправка не удалась', async () => {
    const { repository, deliveries } = createRepository();
    await repository.releaseDelivery('2026:19:race', 123);
    expect(deliveries.deleteOne).toHaveBeenCalledWith({ sessionId: '2026:19:race', chatId: 123 });
  });

  it('чистит устаревший кэш протоколов практик', async () => {
    const { repository, cache } = createRepository();
    await repository.deletePracticeResults();
    expect(cache.deleteMany).toHaveBeenCalledWith({
      kind: 'sessionResult',
      key: { $regex: /^session:\d+:\d+:practice/ },
    });
  });
});

describe('F1SubscribersRepository', () => {
  it('частично обновляет настройки и не затирает остальные поля', async () => {
    const collection = {
      createIndex: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn(),
      findOneAndUpdate: vi.fn().mockResolvedValue({ chatId: 123, fullProtocols: true }),
    };
    const db = { collection: vi.fn().mockReturnValue(collection) } as unknown as Db;
    const repository = new F1SubscribersRepository(db);

    await repository.ensureIndexes();
    await repository.upsert(123, { fullProtocols: true });

    expect(collection.createIndex).toHaveBeenCalledWith({ chatId: 1 }, { unique: true });
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { chatId: 123 },
      {
        $set: { fullProtocols: true, updatedAt: expect.any(Date) },
        $setOnInsert: {
          chatId: 123,
          enabled: DEFAULT_F1_SETTINGS.enabled,
          reminders: DEFAULT_F1_SETTINGS.reminders,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  });
});
