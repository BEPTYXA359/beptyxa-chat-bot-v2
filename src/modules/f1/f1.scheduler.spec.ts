import { describe, expect, it, vi } from 'vitest';
import type { Agenda, Job } from 'agenda';
import type { Bot } from 'grammy';
import type { F1Repository } from './f1.repository';
import type { F1SubscribersRepository } from './f1-subscribers.repository';
import { F1StandingsNotReadyError, type F1Service } from './f1.service';
import { F1Scheduler, f1DeliveryBackoff } from './f1.scheduler';
import type {
  F1Calendar,
  F1SessionResult,
  F1SessionSchedule,
  F1SubscriberDocument,
} from './f1.types';
import type { BotContext } from '../../bot/bot.types';

vi.mock('../../shared/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

const JOB_CALENDAR = 'f1_calendar_refresh';
const JOB_REMINDER = 'f1_session_reminder';
const JOB_POLL = 'f1_session_poll';
const JOB_DELIVERY = 'f1_session_delivery';

const race: F1SessionSchedule = {
  id: '2026:1:race',
  season: 2026,
  round: 1,
  kind: 'race',
  label: 'Гонка',
  raceName: 'Grand Prix',
  startsAt: '2026-03-01T15:00:00.000Z',
  expectedEnd: '2026-03-01T17:00:00.000Z',
};
const calendar: F1Calendar = {
  season: 2026,
  rounds: [
    {
      season: 2026,
      round: 1,
      raceName: 'Grand Prix',
      country: 'Country',
      circuitName: 'Circuit',
      startsAt: race.startsAt,
      sessions: [race],
    },
  ],
};
const subscriber = (chatId: number, reminders: number[] = [30]): F1SubscriberDocument => ({
  chatId,
  enabled: true,
  fullProtocols: false,
  reminders,
  updatedAt: new Date(),
});
const published: F1SessionResult = {
  session: race,
  entries: [
    {
      position: 1,
      positionText: '1',
      driverName: 'Lando Norris',
      driverNameRu: 'Ландо Норрис',
      constructorName: 'McLaren',
      constructorNameRu: 'Макларен',
      dnf: false,
    },
  ],
  publishedAt: '2026-03-01T17:05:00.000Z',
};

// настоящий Job приходит из обработчика Agenda; для переноса хватает schedule()
const createJob = (): Job<SessionJobData> =>
  ({ schedule: vi.fn() }) as unknown as Job<SessionJobData>;

interface StoredJob {
  name?: string;
  data: Record<string, unknown>;
  nextRunAt?: Date;
}

const createScheduler = (
  now = new Date('2026-03-01T12:00:00Z'),
  calendarOverride: F1Calendar = calendar,
  storedJobs: StoredJob[] = [{ data: { sessionId: 'old', minutes: 15 } }],
) => {
  const created: Array<{
    name: string;
    data: Record<string, unknown>;
    at?: Date;
    uniqueQuery?: Record<string, unknown>;
  }> = [];
  const agenda = {
    define: vi.fn(),
    every: vi.fn().mockResolvedValue({}),
    create: vi.fn((name: string, data: Record<string, unknown>) => {
      const record: {
        name: string;
        data: Record<string, unknown>;
        at?: Date;
        uniqueQuery?: Record<string, unknown>;
        save: ReturnType<typeof vi.fn>;
        unique: ReturnType<typeof vi.fn>;
        schedule: ReturnType<typeof vi.fn>;
      } = {
        name,
        data,
        save: vi.fn().mockResolvedValue(undefined),
        unique: vi.fn(),
        schedule: vi.fn(),
      };
      record.unique.mockImplementation((query: Record<string, unknown>) => {
        record.uniqueQuery = query;
        return record;
      });
      record.schedule.mockImplementation((at: Date) => {
        record.at = at;
        return record;
      });
      created.push(record);
      return record;
    }),
    queryJobs: vi.fn(async ({ name }: { name: string }) => {
      // реальные queryJobs возвращают документы задания (data, nextRunAt), а не экземпляры Job
      const jobs = storedJobs.filter((job) => !job.name || job.name === name);
      return { jobs, total: jobs.length };
    }),
    cancel: vi.fn().mockResolvedValue(1),
  };
  const subscribers = {
    getEnabled: vi
      .fn()
      .mockResolvedValue([subscriber(1, [30]), subscriber(2, [60]), subscriber(3, [30])]),
    getByChat: vi.fn().mockImplementation((chatId: number) => Promise.resolve(subscriber(chatId))),
  };
  const repository = {
    getSessionResult: vi.fn().mockResolvedValue(null),
    getStandingsSnapshot: vi.fn().mockResolvedValue(null),
    hasDelivery: vi.fn().mockResolvedValue(false),
    markDelivery: vi.fn().mockResolvedValue(undefined),
    releaseDelivery: vi.fn().mockResolvedValue(undefined),
  };
  const service = {
    refreshCalendar: vi.fn().mockResolvedValue(calendarOverride),
    getSessionResult: vi.fn().mockResolvedValue(null),
    captureStandings: vi.fn().mockResolvedValue(null),
  };
  const bot = {
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
      sendRichMessage: vi.fn().mockResolvedValue({}),
    },
  };
  const scheduler = new F1Scheduler(
    agenda as unknown as Agenda,
    service as unknown as F1Service,
    repository as unknown as F1Repository,
    subscribers as unknown as F1SubscribersRepository,
    bot as unknown as Bot<BotContext>,
    () => now,
  );
  return { scheduler, agenda, created, subscribers, repository, service, bot };
};

describe('F1Scheduler.reconcile', () => {
  it('ставит ежедневное обновление и unique-напоминания для объединения интервалов', async () => {
    const { scheduler, agenda, created } = createScheduler();
    await scheduler.init();
    expect(agenda.every).toHaveBeenCalledWith('0 4 * * *', JOB_CALENDAR, undefined, {
      timezone: 'Europe/Moscow',
    });
    const reminders = created.filter((job) => job.name === JOB_REMINDER);
    expect(reminders.map((job) => job.data.minutes).sort()).toEqual([30, 60]);
    expect(reminders.every((job) => job.uniqueQuery?.['data.sessionId'] === race.id)).toBe(true);
  });

  it('не ставит прошедшие напоминания и удаляет устаревшие', async () => {
    const { scheduler, created, agenda } = createScheduler(new Date('2026-03-01T14:45:00Z'));
    await scheduler.reconcile();
    expect(created.some((job) => job.name === JOB_REMINDER && job.data.minutes === 30)).toBe(false);
    expect(created.some((job) => job.name === JOB_REMINDER && job.data.minutes === 60)).toBe(false);
    expect(agenda.cancel).toHaveBeenCalledWith({
      name: JOB_REMINDER,
      data: { sessionId: 'old', minutes: 15 },
    });
  });

  it('не перезаписывает напоминание, которое уже стоит на нужное время', async () => {
    const existing = {
      name: JOB_REMINDER,
      data: { sessionId: race.id, minutes: 30 },
      nextRunAt: new Date('2026-03-01T14:30:00.000Z'),
    };
    const { scheduler, created, agenda } = createScheduler(
      new Date('2026-03-01T12:00:00Z'),
      calendar,
      [existing],
    );
    await scheduler.reconcile();

    // 60 минут ставится, 30 уже стоит на 14:30 — перезаписывать не нужно
    expect(
      created.filter((job) => job.name === JOB_REMINDER).map((job) => job.data.minutes),
    ).toEqual([60]);
    expect(agenda.cancel).not.toHaveBeenCalled();
  });

  it('переносит напоминание, если время сессии изменилось', async () => {
    const existing = {
      name: JOB_REMINDER,
      data: { sessionId: race.id, minutes: 30 },
      nextRunAt: new Date('2026-03-01T14:00:00.000Z'),
    };
    const { scheduler, created, agenda } = createScheduler(
      new Date('2026-03-01T12:00:00Z'),
      calendar,
      [existing],
    );
    await scheduler.reconcile();

    expect(agenda.cancel).toHaveBeenCalledWith({
      name: JOB_REMINDER,
      data: { sessionId: race.id, minutes: 30 },
    });
    const moved = created.find((job) => job.name === JOB_REMINDER && job.data.minutes === 30);
    expect(moved?.at).toEqual(new Date('2026-03-01T14:30:00.000Z'));
  });

  it('восстанавливает кубок перед доставкой уже кэшированного протокола', async () => {
    const { scheduler, repository, service } = createScheduler(new Date('2026-03-01T17:20:00Z'));
    repository.getSessionResult.mockResolvedValue(published);
    await scheduler.reconcile();
    expect(service.captureStandings).toHaveBeenCalledWith(race);
  });

  it('ждёт обновления кубка вместо доставки устаревших дельт', async () => {
    const { scheduler, repository, service, created } = createScheduler(
      new Date('2026-03-01T17:20:00Z'),
    );
    repository.getSessionResult.mockResolvedValue(published);
    service.captureStandings.mockRejectedValue(new F1StandingsNotReadyError(race.id));

    await expect(scheduler.reconcile()).resolves.toBeUndefined();

    expect(created.filter((job) => job.name === JOB_DELIVERY)).toHaveLength(0);
    const poll = created.find((job) => job.name === JOB_POLL);
    expect(poll?.at).toEqual(new Date('2026-03-01T17:35:00.000Z'));
  });

  it('достаёт протокол, опубликованный после окна поллинга, в течение суток', async () => {
    // окно поллинга: 17:00 + 4 часа; сейчас 23:00 — результат появился позже окна
    const { scheduler, service, created } = createScheduler(new Date('2026-03-01T23:00:00Z'));
    service.getSessionResult.mockResolvedValue(published);
    await scheduler.reconcile();

    expect(service.getSessionResult).toHaveBeenCalledWith(race, true);
    // после окна ждать свежий кубок уже бессмысленно — фиксируем какой есть
    expect(service.captureStandings).toHaveBeenCalledWith(race, { allowStaleStandings: true });
    expect(created.filter((job) => job.name === JOB_DELIVERY)).toHaveLength(3);
    expect(created.some((job) => job.name === JOB_POLL)).toBe(false);
  });

  it('прогревает протокол старой сессии для обзора, но не поллит её', async () => {
    const { scheduler, service, created } = createScheduler(new Date('2026-03-02T18:00:00Z'));
    await scheduler.reconcile();

    // протоколы неизменяемы: достаём один раз без force, poll-джобы не создаются
    expect(service.getSessionResult).toHaveBeenCalledTimes(1);
    expect(service.getSessionResult).toHaveBeenCalledWith(race);
    expect(created.filter((job) => job.name === JOB_POLL)).toHaveLength(0);
  });

  it('пересоздаёт опрос, если прошлый poll-джоб мёртв', async () => {
    const { scheduler, created } = createScheduler(new Date('2026-03-01T12:00:00Z'), calendar, [
      { name: JOB_POLL, data: { sessionId: race.id }, nextRunAt: null },
    ]);
    await scheduler.reconcile();

    expect(created.filter((job) => job.name === JOB_POLL).map((job) => job.data.sessionId)).toEqual(
      [race.id],
    );
  });

  it('не поллит протоколы практик — источник только Jolpica', async () => {
    const practice: F1SessionSchedule = {
      ...race,
      id: '2026:1:practice1',
      kind: 'practice1',
      startsAt: '2026-03-01T12:00:00.000Z',
      expectedEnd: '2026-03-01T13:00:00.000Z',
    };
    const calendarWithPractice: F1Calendar = {
      ...calendar,
      rounds: [{ ...calendar.rounds[0], sessions: [practice, race] }],
    };
    const { scheduler, created } = createScheduler(
      new Date('2026-03-01T12:30:00Z'),
      calendarWithPractice,
    );
    await scheduler.reconcile();

    expect(created.filter((job) => job.name === JOB_POLL).map((job) => job.data.sessionId)).toEqual(
      ['2026:1:race'],
    );
  });

  it('не поллит спринт-квалификацию — Jolpica не отдаёт её протокол', async () => {
    const sprintQualifying: F1SessionSchedule = {
      ...race,
      id: '2026:1:sprintQualifying',
      kind: 'sprintQualifying',
      startsAt: '2026-03-01T14:00:00.000Z',
      expectedEnd: '2026-03-01T15:00:00.000Z',
    };
    const calendarWithSprintQualifying: F1Calendar = {
      ...calendar,
      rounds: [{ ...calendar.rounds[0], sessions: [sprintQualifying, race] }],
    };
    const { scheduler, created } = createScheduler(
      new Date('2026-03-01T12:30:00Z'),
      calendarWithSprintQualifying,
    );
    await scheduler.reconcile();

    expect(created.filter((job) => job.name === JOB_POLL).map((job) => job.data.sessionId)).toEqual(
      ['2026:1:race'],
    );
    // напоминание о спринт-квалификации остаётся — время сессии известно
    expect(
      created.some(
        (job) => job.name === JOB_REMINDER && job.data.sessionId === sprintQualifying.id,
      ),
    ).toBe(true);
  });
});

describe('F1Scheduler.pollSession', () => {
  it('переносит отсутствующий результат на 15 минут', async () => {
    const { scheduler, service } = createScheduler(new Date('2026-03-01T17:20:00Z'));
    const job = createJob();
    await scheduler.pollSession(job, race.id);
    expect(service.getSessionResult).toHaveBeenCalledWith(race, true);
    // переносим сам выполняющийся job — новый unique-job изнутри обработчика затёрся бы
    expect(job.schedule).toHaveBeenCalledWith(new Date('2026-03-01T17:35:00.000Z'));
  });

  it('прекращает поллинг через четыре часа', async () => {
    const { scheduler, service } = createScheduler(new Date('2026-03-01T21:01:00Z'));
    const job = createJob();
    await scheduler.pollSession(job, race.id);
    expect(service.getSessionResult).not.toHaveBeenCalled();
    expect(job.schedule).not.toHaveBeenCalled();
  });

  it('сохраняет снапшот и ставит отдельную доставку каждому чату', async () => {
    const { scheduler, created, service } = createScheduler(new Date('2026-03-01T17:20:00Z'));
    service.getSessionResult.mockResolvedValue(published);
    const job = createJob();
    await scheduler.pollSession(job, race.id);
    expect(service.captureStandings).toHaveBeenCalledWith(race);
    expect(
      created.filter((job) => job.name === JOB_DELIVERY).map((job) => job.data.chatId),
    ).toEqual([1, 2, 3]);
    expect(job.schedule).not.toHaveBeenCalled();
  });

  it('повторяет polling через 15 минут после временной ошибки источника', async () => {
    const { scheduler, service } = createScheduler(new Date('2026-03-01T17:20:00Z'));
    service.getSessionResult.mockRejectedValue(new Error('timeout'));
    const job = createJob();

    await expect(scheduler.pollSession(job, race.id)).resolves.toBeUndefined();

    expect(job.schedule).toHaveBeenCalledWith(new Date('2026-03-01T17:35:00.000Z'));
  });

  it('ждёт обновления кубка и переносит поллинг вместо доставки', async () => {
    const { scheduler, created, service, agenda } = createScheduler(
      new Date('2026-03-01T17:20:00Z'),
    );
    service.getSessionResult.mockResolvedValue(published);
    service.captureStandings.mockRejectedValue(new F1StandingsNotReadyError(race.id));
    const job = createJob();

    await expect(scheduler.pollSession(job, race.id)).resolves.toBeUndefined();

    expect(job.schedule).toHaveBeenCalledWith(new Date('2026-03-01T17:35:00.000Z'));
    expect(created.filter((job) => job.name === JOB_DELIVERY)).toHaveLength(0);
    expect(agenda.cancel).not.toHaveBeenCalledWith({
      name: JOB_POLL,
      data: { sessionId: race.id },
    });
  });

  it('не фиксирует кубок после квалификации, но ставит доставки', async () => {
    const qualifying: F1SessionSchedule = {
      ...race,
      id: '2026:1:qualifying',
      kind: 'qualifying',
      startsAt: '2026-03-01T12:00:00.000Z',
      expectedEnd: '2026-03-01T13:00:00.000Z',
    };
    const { scheduler, created, service } = createScheduler(new Date('2026-03-01T13:20:00Z'), {
      ...calendar,
      rounds: [{ ...calendar.rounds[0], sessions: [qualifying, race] }],
    });
    service.getSessionResult.mockResolvedValue(published);
    const job = createJob();

    await scheduler.pollSession(job, qualifying.id);

    expect(service.captureStandings).not.toHaveBeenCalled();
    expect(
      created.filter((job) => job.name === JOB_DELIVERY).map((job) => job.data.chatId),
    ).toEqual([1, 2, 3]);
    expect(job.schedule).not.toHaveBeenCalled();
  });
});

describe('F1Scheduler.sendReminder', () => {
  it('продолжает рассылку после ошибки отправки в один чат', async () => {
    const { agenda, bot } = createScheduler();
    const handler = agenda.define.mock.calls.find(([name]) => name === JOB_REMINDER)?.[1] as (job: {
      attrs: { data: { sessionId: string; minutes: number } };
    }) => Promise<void>;
    bot.api.sendMessage.mockRejectedValueOnce(new Error('chat unavailable'));

    await expect(
      handler({ attrs: { data: { sessionId: race.id, minutes: 30 } } }),
    ).resolves.toBeUndefined();

    expect(bot.api.sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual([1, 3]);
  });

  it('не отправляет напоминание об уже начавшейся сессии', async () => {
    // бот лежал в момент срабатывания задания — гонка уже идёт полтора часа
    const { agenda, bot } = createScheduler(new Date('2026-03-01T16:30:00Z'));
    const handler = agenda.define.mock.calls.find(([name]) => name === JOB_REMINDER)?.[1] as (job: {
      attrs: { data: { sessionId: string; minutes: number } };
    }) => Promise<void>;

    await expect(
      handler({ attrs: { data: { sessionId: race.id, minutes: 30 } } }),
    ).resolves.toBeUndefined();

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
});

describe('F1Scheduler.deliverSession', () => {
  it('не доставляет повторно после рестарта', async () => {
    const { scheduler, repository, bot } = createScheduler();
    repository.hasDelivery.mockResolvedValue(true);
    await scheduler.deliverSession(race.id, 1);
    expect(bot.api.sendRichMessage).not.toHaveBeenCalled();
    expect(repository.markDelivery).not.toHaveBeenCalled();
  });

  it('резервирует доставку до отправки, чтобы ретрай не продублировал сообщение', async () => {
    const { scheduler, repository, bot } = createScheduler();
    repository.getSessionResult.mockResolvedValue(published);
    await scheduler.deliverSession(race.id, 1);

    expect(bot.api.sendRichMessage).toHaveBeenCalled();
    const reserveOrder = repository.markDelivery.mock.invocationCallOrder[0];
    const sendOrder = bot.api.sendRichMessage.mock.invocationCallOrder[0];
    expect(reserveOrder).toBeLessThan(sendOrder);
  });

  it('снимает резерв и пробрасывает ошибку, если отправка не удалась', async () => {
    const { scheduler, repository, bot } = createScheduler();
    repository.getSessionResult.mockResolvedValue(published);
    bot.api.sendRichMessage.mockRejectedValue(new Error('network'));

    await expect(scheduler.deliverSession(race.id, 1)).rejects.toThrow('network');

    expect(repository.releaseDelivery).toHaveBeenCalledWith(race.id, 1);
  });
});

describe('f1DeliveryBackoff', () => {
  it('не повторяет 403 и ограничивает transient retry экспонентой', () => {
    expect(
      f1DeliveryBackoff({ error: { error_code: 403 }, attempt: 1 } as Parameters<
        typeof f1DeliveryBackoff
      >[0]),
    ).toBeNull();
    expect(
      f1DeliveryBackoff({ error: new Error('network'), attempt: 2 } as Parameters<
        typeof f1DeliveryBackoff
      >[0]),
    ).toBe(120000);
    expect(
      f1DeliveryBackoff({ error: new Error('network'), attempt: 4 } as Parameters<
        typeof f1DeliveryBackoff
      >[0]),
    ).toBeNull();
  });
});
