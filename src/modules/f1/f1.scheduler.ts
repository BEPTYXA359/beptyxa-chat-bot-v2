import type { Agenda, BackoffContext, Job } from 'agenda';
import type { Bot } from 'grammy';
import type { BotContext } from '../../bot/bot.types';
import { logger } from '../../shared/logger';
import { formatReminder, formatSessionMessage, sendF1RichWithFallback } from './f1.formatter';
import type { F1Repository } from './f1.repository';
import { F1StandingsNotReadyError, POINTS_SESSION_KINDS, type F1Service } from './f1.service';
import type { F1SubscribersRepository } from './f1-subscribers.repository';
import type { F1Calendar, F1SessionSchedule } from './f1.types';

const CALENDAR_JOB = 'f1_calendar_refresh';
const REMINDER_JOB = 'f1_session_reminder';
const POLL_JOB = 'f1_session_poll';
const DELIVERY_JOB = 'f1_session_delivery';
const POLL_DELAY_MS = 15 * 60_000;
const POLL_WINDOW_MS = 4 * 60 * 60_000;
// классификация может выйти позже окна поллинга или бот мог лежать:
// в течение суток после окна пробуем достать протокол при каждом reconcile
const CATCH_UP_WINDOW_MS = 24 * 60 * 60_000;
const JOBS_PAGE_SIZE = 1000;

type SessionJobData = { sessionId: string };
type ReminderJobData = SessionJobData & { minutes: number };
type DeliveryJobData = SessionJobData & { chatId: number };

/** Документ задания, который возвращают agenda.queryJobs */
interface StoredJob<T> {
  name: string;
  data: T;
  nextRunAt?: Date | null;
}

export function f1DeliveryBackoff({ error, attempt }: BackoffContext): number | null {
  if (
    error &&
    typeof error === 'object' &&
    'error_code' in error &&
    [400, 403].includes(Number(error.error_code))
  ) {
    return null;
  }
  return attempt <= 3 ? 60_000 * 2 ** (attempt - 1) : null;
}

const reminderKey = (sessionId: string, minutes: number): string => `${sessionId}:${minutes}`;

export class F1Scheduler {
  constructor(
    private readonly agenda: Agenda,
    private readonly service: F1Service,
    private readonly repository: F1Repository,
    private readonly subscribers: F1SubscribersRepository,
    private readonly bot: Bot<BotContext>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.defineJobs();
  }

  private defineJobs(): void {
    this.agenda.define(CALENDAR_JOB, async () => {
      await this.reconcile();
    });
    this.agenda.define(REMINDER_JOB, async (job: Job<ReminderJobData>) => {
      await this.sendReminder(job.attrs.data);
    });
    this.agenda.define(
      POLL_JOB,
      async (job: Job<SessionJobData>) => {
        await this.pollSession(job, job.attrs.data.sessionId);
      },
      { removeOnComplete: true },
    );
    this.agenda.define(
      DELIVERY_JOB,
      async (job: Job<DeliveryJobData>) => {
        await this.deliverSession(job.attrs.data.sessionId, job.attrs.data.chatId);
      },
      { lockLifetime: 60_000, backoff: f1DeliveryBackoff, removeOnComplete: true },
    );
  }

  async init(): Promise<void> {
    await this.agenda.every('0 4 * * *', CALENDAR_JOB, undefined, {
      timezone: 'Europe/Moscow',
    });
    await this.reconcile();
  }

  async reconcile(): Promise<void> {
    const [calendar, enabledSubscribers] = await Promise.all([
      this.service.refreshCalendar(),
      this.subscribers.getEnabled(),
    ]);
    const intervals = new Set(enabledSubscribers.flatMap((subscriber) => subscriber.reminders));
    const now = this.now().getTime();

    const existingReminders = await this.storedJobs<ReminderJobData>(REMINDER_JOB);
    const desiredReminders = new Map<string, { data: ReminderJobData; runAt: Date }>();
    for (const session of this.sessions(calendar)) {
      for (const minutes of intervals) {
        const runAt = new Date(Date.parse(session.startsAt) - minutes * 60_000);
        if (runAt.getTime() <= now) continue;
        desiredReminders.set(reminderKey(session.id, minutes), {
          data: { sessionId: session.id, minutes },
          runAt,
        });
      }
    }

    // снимаем устаревшие и перенесённые (изменилось время сессии)
    for (const job of existingReminders) {
      const desired = desiredReminders.get(reminderKey(job.data.sessionId, job.data.minutes));
      if (desired && job.nextRunAt?.getTime() === desired.runAt.getTime()) continue;
      await this.agenda.cancel({ name: REMINDER_JOB, data: job.data });
    }
    // ставим только недостающие: reconcile идёт при каждом сохранении настроек
    for (const [key, { data, runAt }] of desiredReminders) {
      const unchanged = existingReminders.some(
        (job) =>
          reminderKey(job.data.sessionId, job.data.minutes) === key &&
          job.nextRunAt?.getTime() === runAt.getTime(),
      );
      if (!unchanged) {
        await this.scheduleUnique(REMINDER_JOB, data, runAt, {
          'data.sessionId': data.sessionId,
          'data.minutes': data.minutes,
        });
      }
    }

    // мёртвые poll-джобы (nextRunAt=null, например после сбоя) не считаем существующими:
    // unique-пересоздание оживит их документ, живой опрос дублировать не нужно
    const existingPolls = (await this.storedJobs<SessionJobData>(POLL_JOB)).filter(
      (job) => job.nextRunAt != null,
    );
    const wantedPollIds = new Set<string>();
    for (const session of this.sessions(calendar)) {
      if (!this.hasResultSource(session)) continue;
      const sessionEnd = Date.parse(session.expectedEnd);
      const inPollWindow = now <= sessionEnd + POLL_WINDOW_MS;
      const inCatchUpWindow = now <= sessionEnd + CATCH_UP_WINDOW_MS;
      if (!inCatchUpWindow) {
        // протоколы неизменяемы: сессия завершилась давно, но кэша нет — прогреваем,
        // чтобы первый запрос обзора не ждал цепочки запросов к Jolpica за каждый этап
        if (sessionEnd < now) {
          try {
            await this.service.getSessionResult(session);
          } catch (error) {
            logger.warn({ err: error, sessionId: session.id }, 'Не удалось прогреть протокол Ф1');
          }
        }
        continue;
      }

      const cached = await this.repository.getSessionResult(session.id);
      if (!cached) {
        if (!inPollWindow) {
          await this.catchUpSession(session);
          continue;
        }
        wantedPollIds.add(session.id);
        if (!existingPolls.some((job) => job.data.sessionId === session.id)) {
          await this.schedulePoll(session, new Date(Math.max(sessionEnd + POLL_DELAY_MS, now)));
        }
        continue;
      }

      try {
        const state = await this.publishSession(session, inPollWindow);
        if (state === 'waiting') wantedPollIds.add(session.id);
      } catch (error) {
        logger.warn({ err: error, sessionId: session.id }, 'Ошибка публикации протокола Ф1');
        if (inPollWindow) wantedPollIds.add(session.id);
      }
      if (
        wantedPollIds.has(session.id) &&
        !existingPolls.some((job) => job.data.sessionId === session.id)
      ) {
        await this.schedulePoll(session, new Date(now + POLL_DELAY_MS));
      }
    }

    for (const job of existingPolls) {
      if (!wantedPollIds.has(job.data.sessionId)) {
        await this.agenda.cancel({ name: POLL_JOB, data: job.data });
      }
    }
  }

  /**
   * Повторный опрос переносим через job.schedule на переданном экземпляре: unique-создание
   * нового job изнутри обработчика бесполезно — Agenda обновит документ выполняющегося job,
   * а в finally Job.run() перезапишет nextRunAt значением из памяти
   */
  async pollSession(job: Job<SessionJobData>, sessionId: string): Promise<void> {
    const calendar = await this.service.refreshCalendar();
    const session = this.sessions(calendar).find((item) => item.id === sessionId);
    if (!session) return;
    const now = this.now().getTime();
    if (now > Date.parse(session.expectedEnd) + POLL_WINDOW_MS) return;

    try {
      const result = await this.service.getSessionResult(session, true);
      if (!result) {
        job.schedule(new Date(now + POLL_DELAY_MS));
        return;
      }

      if ((await this.publishSession(session, true)) === 'waiting') {
        job.schedule(new Date(now + POLL_DELAY_MS));
        return;
      }
      await this.agenda.cancel({ name: POLL_JOB, data: { sessionId } });
    } catch (error) {
      logger.warn(
        { err: error, sessionId },
        'Ошибка polling результатов Ф1; повтор через 15 минут',
      );
      job.schedule(new Date(now + POLL_DELAY_MS));
    }
  }

  /**
   * Кубок + рассылка. В окне поллинга ждём свежий кубок, после окна фиксируем какой есть.
   * Кубок фиксируем только после очковых сессий: после квалификации он не меняется,
   * и блок с нулевыми дельтами в сообщении — шум
   */
  private async publishSession(
    session: F1SessionSchedule,
    waitForStandings: boolean,
  ): Promise<'published' | 'waiting'> {
    if (POINTS_SESSION_KINDS.has(session.kind)) {
      try {
        if (waitForStandings) await this.service.captureStandings(session);
        else await this.service.captureStandings(session, { allowStaleStandings: true });
      } catch (error) {
        if (!waitForStandings || !(error instanceof F1StandingsNotReadyError)) throw error;
        logger.info(
          { sessionId: session.id },
          'Кубок после этапа ещё не обновился; повтор через 15 минут',
        );
        return 'waiting';
      }
    }
    await this.scheduleDeliveries(session);
    return 'published';
  }

  /** Протокол опубликовался позже окна поллинга или бот пропустил сессию */
  private async catchUpSession(session: F1SessionSchedule): Promise<void> {
    try {
      const result = await this.service.getSessionResult(session, true);
      if (!result) return;
      await this.publishSession(session, false);
    } catch (error) {
      logger.warn(
        { err: error, sessionId: session.id },
        'Ошибка достройки пропущенного протокола Ф1',
      );
    }
  }

  async deliverSession(sessionId: string, chatId: number): Promise<void> {
    const settings = await this.subscribers.getByChat(chatId);
    if (!settings?.enabled) return;
    if (await this.repository.hasDelivery(sessionId, chatId)) return;

    const result = await this.repository.getSessionResult(sessionId);
    if (!result) return;
    const standings = await this.repository.getStandingsSnapshot(sessionId);
    const message = formatSessionMessage(result, standings, settings.fullProtocols);
    // резервируем до отправки: иначе сбой после успешной отправки продублирует сообщение при ретрае
    await this.repository.markDelivery(sessionId, chatId);
    try {
      await sendF1RichWithFallback(this.bot.api, chatId, message);
    } catch (error) {
      await this.repository.releaseDelivery(sessionId, chatId).catch((releaseError: unknown) => {
        logger.warn(
          { err: releaseError, sessionId, chatId },
          'Не удалось снять резерв доставки Ф1; сообщение может быть пропущено',
        );
      });
      throw error;
    }
  }

  private async sendReminder(data: ReminderJobData): Promise<void> {
    const calendar = await this.service.refreshCalendar();
    const session = this.sessions(calendar).find((item) => item.id === data.sessionId);
    if (!session) return;
    // бот мог лежать в момент срабатывания задания — не напоминаем об уже начавшейся сессии
    if (Date.parse(session.startsAt) <= this.now().getTime()) return;
    const enabledSubscribers = await this.subscribers.getEnabled();
    for (const subscriber of enabledSubscribers) {
      if (!subscriber.reminders.includes(data.minutes)) continue;
      try {
        await this.bot.api.sendMessage(subscriber.chatId, formatReminder(session, data.minutes));
      } catch (error) {
        logger.warn(
          { err: error, chatId: subscriber.chatId, sessionId: data.sessionId },
          'Не удалось отправить напоминание Ф1 в чат',
        );
      }
    }
  }

  private async scheduleDeliveries(session: F1SessionSchedule): Promise<void> {
    const enabledSubscribers = await this.subscribers.getEnabled();
    for (const subscriber of enabledSubscribers) {
      if (await this.repository.hasDelivery(session.id, subscriber.chatId)) continue;
      await this.scheduleUnique(
        DELIVERY_JOB,
        { sessionId: session.id, chatId: subscriber.chatId },
        this.now(),
        { 'data.sessionId': session.id, 'data.chatId': subscriber.chatId },
      );
    }
  }

  /** Протоколы практик Jolpica не отдаёт, спринт-квалификацию не поддерживает */
  private hasResultSource(session: F1SessionSchedule): boolean {
    return session.kind !== 'sprintQualifying' && !session.kind.startsWith('practice');
  }

  private async schedulePoll(session: F1SessionSchedule, at: Date): Promise<void> {
    await this.scheduleUnique(POLL_JOB, { sessionId: session.id }, at, {
      'data.sessionId': session.id,
    });
  }

  private async scheduleUnique<T extends Record<string, unknown>>(
    name: string,
    data: T,
    at: Date,
    unique: Record<string, unknown>,
  ): Promise<void> {
    const job = this.agenda.create(name, data);
    job.unique({ name, ...unique });
    job.schedule(at);
    await job.save();
  }

  /** Задания одного типа постранично — без лимита в 1000 на выгрузку */
  private async storedJobs<T>(name: string): Promise<StoredJob<T>[]> {
    const jobs: StoredJob<T>[] = [];
    for (let skip = 0; ; skip += JOBS_PAGE_SIZE) {
      const result = await this.agenda.queryJobs({ name, limit: JOBS_PAGE_SIZE, skip });
      const page = result.jobs as unknown as StoredJob<T>[];
      jobs.push(...page);
      if (page.length < JOBS_PAGE_SIZE || jobs.length >= result.total) break;
    }
    return jobs;
  }

  private sessions(calendar: F1Calendar): F1SessionSchedule[] {
    return calendar.rounds.flatMap((round) => round.sessions);
  }
}
