import { Agenda, Job } from 'agenda';
import { ReminderRepository } from './reminder.repository';
import { CreateReminderDto, ReminderDocument } from './reminder.types';
import { logger } from '../../shared/logger';
import { Bot } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { TelegramUser } from '../../shared/types/telegram.types';

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
    this.agenda.define(this.JOB_NAME, async (job: Job) => {
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
        const text = reminder.silent
          ? reminder.message
          : `*${reminder.creatorUsername ? `@${reminder.creatorUsername}` : `[${reminder.creatorFirstName}](tg://user?id=${reminder.createdBy})`}*,\n\n ${reminder.message}`;

        await this.bot.api.sendRichMessage(chatId, { markdown: text });
      } catch (error) {
        logger.error(
          { err: error, chatId, reminderId },
          'Ошибка при выполнении задачи отправки напоминания',
        );
      }

      if (reminder.frequency === 'once') {
        try {
          await this.repository.delete(reminderId);
        } catch (error) {
          logger.error({ err: error, reminderId }, 'Ошибка при удалении выполненного напоминания');
        }
      }
    });
  }

  private async scheduleJob(
    reminderId: string,
    chatId: number,
    doc: Partial<ReminderDocument>,
  ): Promise<void> {
    const jobData = {
      reminderId,
      chatId,
    };

    const job = this.agenda.create(this.JOB_NAME, jobData);
    job.unique({ 'data.reminderId': reminderId });

    if (doc.frequency === 'once') {
      const runAt = new Date(doc.time!);
      job.schedule(runAt);
    } else {
      const [hours, minutes] = doc.time!.split(':').map(Number);

      if (doc.frequency === 'every_other_day') {
        job.schedule(this.getStartDateForTime(hours, minutes, doc.timezone));
        job.repeatEvery('2 days', { timezone: doc.timezone });
      } else {
        let cronExpression = `${minutes} ${hours} * * *`;
        if (doc.frequency === 'specific_days' && doc.specificDays) {
          const days = doc.specificDays.join(',');
          cronExpression = `${minutes} ${hours} * * ${days}`;
        }
        job.repeatEvery(cronExpression, { timezone: doc.timezone });
      }
    }

    await job.save();
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

    const merged = { ...oldReminder, ...updatedFields };

    await this.scheduleJob(reminderId, chatId, merged);
    await this.repository.update(reminderId, updatedFields);
  }

  public async getActiveReminders(chatId: number): Promise<ReminderDocument[]> {
    return this.repository.getActiveByChat(chatId);
  }

  public async deleteReminder(reminderId: string): Promise<void> {
    const reminder = await this.repository.getById(reminderId);
    if (!reminder) return;

    await this.agenda.cancel({
      name: this.JOB_NAME,
      'data.reminderId': reminderId,
    } as any);

    await this.repository.delete(reminderId);
  }

  public async syncJobs(): Promise<void> {
    const reminders = await this.repository.getAll();
    for (const reminder of reminders) {
      const reminderId = reminder._id!.toString();
      await this.agenda.cancel({
        name: this.JOB_NAME,
        'data.reminderId': reminderId,
      } as any);
      await this.scheduleJob(reminderId, reminder.chatId, reminder);
    }
    logger.info({ count: reminders.length }, 'Расписания напоминаний восстановлены');
  }

  private getStartDateForTime(hours: number, minutes: number, timezone?: string): Date {
    if (timezone) {
      const now = new Date();
      const parts = now.toLocaleString('en-US', { timeZone: timezone, hour12: false }).split(', ');
      const [m, d, y] = parts[0].split('/').map(Number);
      const nowInTz = Date.UTC(y, m - 1, d, ...parts[1].split(':').map(Number));

      let start = Date.UTC(y, m - 1, d, hours, minutes, 0, 0);
      if (start <= nowInTz) start += 86_400_000;
      return new Date(start);
    }

    const start = new Date();
    start.setHours(hours, minutes, 0, 0);
    if (start < new Date()) {
      start.setDate(start.getDate() + 1);
    }
    return start;
  }
}
