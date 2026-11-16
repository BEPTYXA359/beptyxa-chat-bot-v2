import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Agenda, Job } from 'agenda';
import type { Bot } from 'grammy';
import type { ReminderRepository } from './reminder.repository';
import type { SteamService } from '../steam/steam.service';
import type { ConversionSettingsService } from '../conversion/conversion-settings.service';
import type { BotContext } from '../../bot/bot.types';
import type { ReminderDocument } from './reminder.types';

process.env.NODE_ENV = 'development';
const { ReminderService } = await import('./reminder.service');

function createService(repository: Partial<ReminderRepository>, sendRichMessage = vi.fn()) {
  const job = {
    unique: vi.fn(),
    schedule: vi.fn(),
    startDate: vi.fn(),
    repeatEvery: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const agenda = {
    define: vi.fn(),
    cancel: vi.fn().mockResolvedValue(1),
    create: vi.fn().mockReturnValue(job),
  };
  const service = new ReminderService(
    repository as ReminderRepository,
    agenda as unknown as Agenda,
    { api: { sendRichMessage } } as unknown as Bot<BotContext>,
    {} as SteamService,
    {} as ConversionSettingsService,
  );
  return { service, agenda };
}

function reminder(chatId: number): ReminderDocument {
  return {
    _id: new ObjectId(),
    chatId,
    message: 'test',
    frequency: 'daily',
    time: '12:00',
    timezone: 'UTC',
    createdAt: new Date(),
    createdBy: 111,
    creatorFirstName: 'Test',
  };
}

const dto = {
  message: 'updated',
  frequency: 'daily' as const,
  time: '13:00',
  timezone: 'UTC',
  silent: false,
};

describe('владение напоминаниями', () => {
  it('не обновляет напоминание другого чата', async () => {
    const repository = {
      getById: vi.fn().mockResolvedValue(reminder(-100)),
      update: vi.fn(),
    };
    const { service, agenda } = createService(repository);
    const id = new ObjectId().toString();

    await expect(service.updateReminder(id, -200, dto)).rejects.toThrow('Напоминание не найдено');
    expect(agenda.cancel).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('не удаляет напоминание другого чата', async () => {
    const repository = {
      getById: vi.fn().mockResolvedValue(reminder(-100)),
      delete: vi.fn(),
    };
    const { service, agenda } = createService(repository);
    const id = new ObjectId().toString();

    await expect(service.deleteReminder(id, -200)).rejects.toThrow('Напоминание не найдено');
    expect(agenda.cancel).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  });
});

describe('доставка напоминаний', () => {
  it('возвращает transient-ошибку в Agenda и не завершает одноразовое напоминание', async () => {
    const document = { ...reminder(-100), frequency: 'once' as const };
    const repository = {
      getById: vi.fn().mockResolvedValue(document),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const { agenda } = createService(
      repository,
      vi.fn().mockRejectedValue(new Error('telegram timeout')),
    );
    const definition = agenda.define.mock.calls.find(([name]) => name === 'send_telegram_reminder');
    const handler = definition?.[1] as (job: Job) => Promise<void>;
    const job = {
      attrs: { data: { reminderId: document._id!.toString(), chatId: -100 } },
    } as Job;

    await expect(handler(job)).rejects.toThrow('telegram timeout');
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('завершает одноразовое напоминание только после успешной отправки', async () => {
    const document = { ...reminder(-100), frequency: 'once' as const };
    const repository = {
      getById: vi.fn().mockResolvedValue(document),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const sendRichMessage = vi.fn().mockResolvedValue({});
    const { agenda } = createService(repository, sendRichMessage);
    const definition = agenda.define.mock.calls.find(([name]) => name === 'send_telegram_reminder');
    const handler = definition?.[1] as (job: Job) => Promise<void>;
    const job = {
      attrs: { data: { reminderId: document._id!.toString(), chatId: -100 } },
    } as Job;

    await handler(job);

    expect(sendRichMessage).toHaveBeenCalledOnce();
    expect(repository.update).toHaveBeenCalledWith(document._id!.toString(), {
      lastFiredAt: expect.any(Date),
    });
    expect(repository.delete).toHaveBeenCalledWith(document._id!.toString());
    expect(agenda.cancel).toHaveBeenCalledWith({ data: { reminderId: document._id!.toString() } });
  });

  it('настраивает ограниченный backoff и не повторяет постоянные ошибки Telegram', () => {
    const { agenda } = createService({});
    const definition = agenda.define.mock.calls.find(([name]) => name === 'send_telegram_reminder');
    const options = definition?.[2] as {
      backoff: (context: { error: Error; attempt: number }) => number | null;
    };

    expect(options.backoff({ error: new Error('timeout'), attempt: 1 })).toBe(60_000);
    expect(options.backoff({ error: new Error('timeout'), attempt: 3 })).toBe(240_000);
    expect(options.backoff({ error: new Error('timeout'), attempt: 4 })).toBeNull();
    expect(
      options.backoff({
        error: Object.assign(new Error('blocked'), { error_code: 403 }),
        attempt: 1,
      }),
    ).toBeNull();
  });
});

describe('напоминания через день', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function everyOtherDay(): ReminderDocument {
    return {
      ...reminder(-100),
      frequency: 'every_other_day',
      time: '09:00',
      timezone: 'America/New_York',
      createdAt: new Date('2026-03-07T14:00:00Z'),
    };
  }

  it('планирует локальное время ежедневно вместо фиксированных 48 часов', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T12:00:00Z'));
    const document = everyOtherDay();
    const repository = {
      getAll: vi.fn().mockResolvedValue([document]),
      getAgendaJobs: vi.fn().mockResolvedValue([]),
    };
    const { service, agenda } = createService(repository);

    await service.reconcileJobs();

    const job = agenda.create.mock.results[0].value;
    expect(job.repeatEvery).toHaveBeenCalledWith('0 9 * * *', {
      timezone: 'America/New_York',
    });
    expect(job.startDate).not.toHaveBeenCalled();
  });

  it('пересоздаёт сохранённую задачу со старым интервалом 2 days', async () => {
    const document = everyOtherDay();
    const repository = {
      getAll: vi.fn().mockResolvedValue([document]),
      getAgendaJobs: vi.fn().mockResolvedValue([
        {
          reminderId: document._id!.toString(),
          name: 'send_telegram_reminder',
          nextRunAt: new Date('2026-03-09T13:00:00Z'),
          repeatInterval: '2 days',
        },
      ]),
    };
    const { service, agenda } = createService(repository);

    await service.reconcileJobs();

    expect(agenda.cancel).toHaveBeenCalledWith({ data: { reminderId: document._id!.toString() } });
    expect(agenda.create).toHaveBeenCalledOnce();
  });

  it('отправляет только в due day и сохраняет 09:00 после весеннего DST', async () => {
    vi.useFakeTimers();
    const document = everyOtherDay();
    const repository = {
      getById: vi.fn().mockResolvedValue(document),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const sendRichMessage = vi.fn().mockResolvedValue({});
    const { agenda } = createService(repository, sendRichMessage);
    const definition = agenda.define.mock.calls.find(([name]) => name === 'send_telegram_reminder');
    const handler = definition?.[1] as (job: Job) => Promise<void>;
    const job = {
      attrs: { data: { reminderId: document._id!.toString(), chatId: -100 } },
    } as Job;

    vi.setSystemTime(new Date('2026-03-08T13:00:00Z'));
    await handler(job);
    expect(sendRichMessage).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-03-09T13:00:00Z'));
    await handler(job);
    expect(sendRichMessage).toHaveBeenCalledOnce();
  });

  it('догоняет последнее локальное срабатывание после осеннего DST', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T14:30:00Z'));
    const document = {
      ...everyOtherDay(),
      createdAt: new Date('2026-11-01T13:00:00Z'),
      lastFiredAt: new Date('2026-11-01T15:01:00Z'),
    };
    const repository = {
      getAll: vi.fn().mockResolvedValue([document]),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const sendRichMessage = vi.fn().mockResolvedValue({});
    const { service } = createService(repository, sendRichMessage);

    await service.catchUpMissed();

    expect(sendRichMessage).toHaveBeenCalledOnce();
    expect(repository.update).toHaveBeenCalledWith(document._id!.toString(), {
      lastFiredAt: new Date('2026-11-03T14:30:00Z'),
    });
  });
});
