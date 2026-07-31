import { Agenda, Job } from 'agenda';
import { ReminderRepository } from './reminder.repository';
import { CreateReminderDto, ReminderDocument } from './reminder.types';
import { logger } from '../../shared/logger';
import { Bot, GrammyError } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { TelegramUser } from '../../shared/types/telegram.types';

type Schedulable = Pick<ReminderDocument, 'frequency' | 'time' | 'specificDays' | 'timezone'>;

export class ReminderService {
  private readonly JOB_NAME = 'send_telegram_reminder';

  constructor(
    private readonly repository: ReminderRepository,
    private readonly agenda: Agenda,
    private readonly bot: Bot<BotContext>,
  ) {
    this.defineJobs();
  }

  private defineJobs(): void {
    this.agenda.define(
      this.JOB_NAME,
      async (job: Job) => {
        const { reminderId, chatId } = job.attrs.data as {
          reminderId: string;
          chatId: number;
        };

        const reminder = await this.repository.getById(reminderId);
        if (!reminder) {
          logger.warn({ reminderId }, 'Напоминание не найдено в БД, пропускаем');
          return;
        }

        try {
          await this.sendReminder(reminder, chatId);
        } catch (error) {
          logger.error({ err: error, chatId, reminderId }, 'Ошибка при отправке напоминания');
          return;
        }

        try {
          await this.repository.update(reminderId, { lastFiredAt: new Date() });
        } catch (error) {
          logger.error({ err: error, reminderId }, 'Ошибка при обновлении lastFiredAt');
        }

        if (reminder.frequency === 'once') {
          try {
            await this.repository.delete(reminderId);
            await this.cancelJob(reminderId);
          } catch (error) {
            logger.error(
              { err: error, reminderId },
              'Ошибка при удалении выполненного напоминания',
            );
          }
        }
      },
      { lockLifetime: 60_000 },
    );
  }

  private buildPlainText(reminder: ReminderDocument): string {
    if (reminder.silent) return reminder.message;
    const mention = reminder.creatorUsername
      ? `@${reminder.creatorUsername}`
      : reminder.creatorFirstName;
    return `${mention},\n\n${reminder.message}`;
  }

  private async sendReminder(reminder: ReminderDocument, chatId: number): Promise<void> {
    const text = this.buildPlainText(reminder);

    try {
      await this.bot.api.sendRichMessage(chatId, { markdown: text });
      return;
    } catch (error) {
      if (!(error instanceof GrammyError && error.error_code === 400)) {
        throw error;
      }
      logger.warn(
        { err: error, chatId, reminderId: reminder._id },
        'Rich-отправка не удалась (400), fallback на plain text',
      );
    }

    await this.bot.api.sendMessage(chatId, text);
  }

  private cancelJob(reminderId: string): Promise<number> {
    return this.agenda.cancel({ name: this.JOB_NAME, data: { reminderId } });
  }

  private async scheduleJob(reminderId: string, chatId: number, doc: Schedulable): Promise<void> {
    const timezone = doc.timezone ?? 'UTC';
    const job = this.agenda.create(this.JOB_NAME, { reminderId, chatId });
    job.unique({ 'data.reminderId': reminderId });

    if (doc.frequency === 'once') {
      const runAt = new Date(doc.time);
      this.assertValidDate(runAt, doc.time);
      job.schedule(runAt);
    } else if (doc.frequency === 'every_other_day') {
      const { hours, minutes } = this.resolveClockTime(doc.time, timezone);
      const runAt = this.nextOccurrence(hours, minutes, timezone);
      job.startDate(runAt);
      job.repeatEvery('2 days');
    } else {
      const { hours, minutes } = this.resolveClockTime(doc.time, timezone);
      let cronExpression = `${minutes} ${hours} * * *`;
      if (doc.frequency === 'specific_days' && doc.specificDays && doc.specificDays.length > 0) {
        cronExpression = `${minutes} ${hours} * * ${doc.specificDays.join(',')}`;
      }
      job.repeatEvery(cronExpression, { timezone });
    }

    await job.save();
  }

  private assertValidDate(date: Date, raw: string): void {
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Невалидное значение времени напоминания: ${raw}`);
    }
  }

  private resolveClockTime(
    time: string,
    timezone: string,
  ): {
    hours: number;
    minutes: number;
  } {
    const legacy = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (legacy) {
      return { hours: Number(legacy[1]) % 24, minutes: Number(legacy[2]) };
    }

    const instant = new Date(time);
    if (Number.isNaN(instant.getTime())) {
      throw new Error(`Невалидное значение времени напоминания: ${time}`);
    }
    return this.instantToClockTime(instant, timezone);
  }

  private nextOccurrence(hours: number, minutes: number, timezone: string): Date {
    const now = new Date();
    const offsetMs = this.getTzOffsetMs(now, timezone);
    const parts = this.getTzParts(now, timezone);

    let candidateMs = Date.UTC(parts.y, parts.m - 1, parts.d, hours, minutes, 0, 0) - offsetMs;
    if (candidateMs <= now.getTime()) {
      candidateMs += 86_400_000;
    }
    return new Date(candidateMs);
  }

  private instantToClockTime(
    instant: Date,
    timezone: string,
  ): {
    hours: number;
    minutes: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = formatter.formatToParts(instant);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return { hours: hour % 24, minutes: minute };
  }

  public async createReminder(
    chatId: number,
    creator: TelegramUser,
    dto: CreateReminderDto,
  ): Promise<void> {
    const reminderDoc = await this.repository.create({
      chatId,
      message: dto.message,
      frequency: dto.frequency,
      time: dto.time,
      specificDays: dto.specificDays,
      timezone: dto.timezone,
      silent: dto.silent,
      createdAt: new Date(),
      createdBy: creator.id,
      creatorFirstName: creator.first_name,
      creatorUsername: creator.username,
    });

    const reminderId = reminderDoc._id!.toString();

    try {
      await this.scheduleJob(reminderId, chatId, dto);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Не удалось запланировать задачу в Agenda');
      await this.repository.delete(reminderId);
      throw new Error('Ошибка планирования напоминания');
    }
  }

  public async updateReminder(
    reminderId: string,
    chatId: number,
    dto: CreateReminderDto,
  ): Promise<void> {
    const oldReminder = await this.repository.getById(reminderId);
    if (!oldReminder) {
      throw new Error('Напоминания не существует');
    }

    const updatedFields: Partial<ReminderDocument> = {
      message: dto.message,
      frequency: dto.frequency,
      time: dto.time,
      specificDays: dto.specificDays,
      timezone: dto.timezone,
      silent: dto.silent,
    };

    try {
      await this.cancelJob(reminderId);
    } catch (error) {
      logger.error({ err: error, reminderId }, 'Не удалось отменить старый джоб при обновлении');
    }

    try {
      await this.scheduleJob(reminderId, chatId, dto);
    } catch (error) {
      logger.error({ err: error, reminderId }, 'Не удалось перепланировать расписание напоминания');
      throw new Error('Не удалось перепланировать расписание напоминания');
    }

    await this.repository.update(reminderId, updatedFields);
  }

  public async getActiveReminders(chatId: number): Promise<ReminderDocument[]> {
    return this.repository.getActiveByChat(chatId);
  }

  public async deleteReminder(reminderId: string): Promise<void> {
    const reminder = await this.repository.getById(reminderId);
    if (!reminder) return;

    await this.cancelJob(reminderId);

    await this.repository.delete(reminderId);
  }

  public async reconcileJobs(): Promise<void> {
    const reminders = await this.repository.getAll();
    const agendaJobs = await this.repository.getAgendaJobs(this.JOB_NAME);

    const reminderIds = new Set(reminders.map((reminder) => reminder._id!.toString()));
    const jobsByReminderId = new Map(agendaJobs.map((job) => [job.reminderId, job]));

    let created = 0;
    let repaired = 0;

    for (const reminder of reminders) {
      const reminderId = reminder._id!.toString();
      const existing = jobsByReminderId.get(reminderId);

      if (!existing) {
        try {
          await this.scheduleJob(reminderId, reminder.chatId, reminder);
          created++;
        } catch (error) {
          logger.error(
            { err: error, reminderId },
            'Не удалось запланировать напоминание при сверке',
          );
        }
        continue;
      }

      if (existing.nextRunAt === null) {
        try {
          await this.cancelJob(reminderId);
        } catch (error) {
          logger.error({ err: error, reminderId }, 'Не удалось удалить «мёртвый» джоб');
        }
        try {
          await this.scheduleJob(reminderId, reminder.chatId, reminder);
          repaired++;
        } catch (error) {
          logger.error({ err: error, reminderId }, 'Не удалось перепланировать «мёртвый» джоб');
        }
      }
    }

    for (const { reminderId } of agendaJobs) {
      if (!reminderIds.has(reminderId)) {
        try {
          await this.cancelJob(reminderId);
        } catch (error) {
          logger.error({ err: error, reminderId }, 'Не удалось удалить orphan-джоб');
        }
      }
    }

    logger.info(
      { total: reminders.length, created, repaired },
      'Расписания напоминаний сверены с Agenda',
    );
  }

  public async catchUpMissed(): Promise<void> {
    const reminders = await this.repository.getAll();

    for (const reminder of reminders) {
      if (reminder.frequency === 'once') continue;
      if (!reminder.lastFiredAt) continue;

      try {
        const lastExpected = this.computeLastExpectedOccurrence(reminder);
        if (!lastExpected) continue;

        if (reminder.lastFiredAt.getTime() < lastExpected.getTime()) {
          logger.info(
            { reminderId: reminder._id, lastExpected },
            'Догоняющая отправка пропущенного напоминания',
          );
          try {
            await this.sendReminder(reminder, reminder.chatId);
            await this.repository.update(reminder._id!.toString(), {
              lastFiredAt: new Date(),
            });
          } catch (error) {
            logger.error(
              { err: error, reminderId: reminder._id },
              'Ошибка догоняющей отправки напоминания',
            );
          }
        }
      } catch (error) {
        logger.error({ err: error, reminderId: reminder._id }, 'Ошибка расчёта catch-up');
      }
    }
  }

  private computeLastExpectedOccurrence(reminder: ReminderDocument): Date | null {
    const timezone = reminder.timezone ?? 'UTC';
    const now = new Date();

    if (reminder.frequency === 'every_other_day') {
      const intervalMs = 2 * 86_400_000;
      const anchor = (reminder.lastFiredAt ?? reminder.createdAt).getTime();
      const stepsAfterAnchor = Math.floor((now.getTime() - anchor) / intervalMs);
      if (stepsAfterAnchor < 1) return null;
      return new Date(anchor + stepsAfterAnchor * intervalMs);
    }

    const { hours, minutes } = this.resolveClockTime(reminder.time, timezone);
    const allowedDays =
      reminder.frequency === 'specific_days' && reminder.specificDays?.length
        ? new Set(reminder.specificDays)
        : new Set([0, 1, 2, 3, 4, 5, 6]);

    const offsetMs = this.getTzOffsetMs(now, timezone);
    const nowParts = this.getTzParts(now, timezone);

    for (let back = 0; back < 8; back++) {
      const dayInstant = new Date(
        Date.UTC(nowParts.y, nowParts.m - 1, nowParts.d) - back * 86_400_000,
      );
      if (!allowedDays.has(dayInstant.getUTCDay())) continue;

      const candidateMs =
        Date.UTC(
          dayInstant.getUTCFullYear(),
          dayInstant.getUTCMonth(),
          dayInstant.getUTCDate(),
          hours,
          minutes,
          0,
          0,
        ) - offsetMs;

      if (back === 0 && candidateMs > now.getTime()) continue;
      return new Date(candidateMs);
    }

    return null;
  }

  private getTzParts(
    instant: Date,
    timezone: string,
  ): {
    y: number;
    m: number;
    d: number;
    h: number;
    mi: number;
    s: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const collected: Record<string, number> = {};
    for (const part of formatter.formatToParts(instant)) {
      if (part.type === 'literal') continue;
      collected[part.type] = Number(part.value);
    }
    return {
      y: collected.year,
      m: collected.month,
      d: collected.day,
      h: collected.hour,
      mi: collected.minute,
      s: collected.second,
    };
  }

  private getTzOffsetMs(instant: Date, timezone: string): number {
    const parts = this.getTzParts(instant, timezone);
    const wallAsUtc = Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s);
    return wallAsUtc - instant.getTime();
  }
}
