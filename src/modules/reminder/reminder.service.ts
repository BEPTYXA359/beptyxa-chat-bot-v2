import { Agenda, Job } from 'agenda';
import { ReminderRepository } from './reminder.repository';
import { CreateReminderDto, ReminderDocument, SteamSubscriber } from './reminder.types';
import { logger } from '../../shared/logger';
import { Bot, GrammyError } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { TelegramUser } from '../../shared/types/telegram.types';
import { SteamService } from '../steam/steam.service';

type Schedulable = Pick<ReminderDocument, 'frequency' | 'time' | 'specificDays' | 'timezone'>;
type SteamGameInfo = Awaited<ReturnType<SteamService['getGameInfo']>>;
type SteamReleaseDateParts = { day: number; month: number; year: number };

export type SteamSubscribeResult = 'created' | 'added' | 'already';

const STEAM_RELEASE_TIMEZONE = 'Europe/Moscow';
const STEAM_RELEASE_HOUR = 12;
// Steam часто разблокирует игры позже полуночи; если в день выхода игра ещё
// не доступна в полдень, повторяем проверку вечером того же дня
const STEAM_RELEASE_RETRY_HOUR = 20;

export class ReminderService {
  private readonly JOB_NAME = 'send_telegram_reminder';
  private readonly STEAM_JOB_NAME = 'send_steam_reminder';
  private readonly STEAM_CHECK_JOB_NAME = 'check_steam_releases';
  private readonly STEAM_CHECK_CRON = `0 ${STEAM_RELEASE_HOUR} * * *`;

  constructor(
    private readonly repository: ReminderRepository,
    private readonly agenda: Agenda,
    private readonly bot: Bot<BotContext>,
    private readonly steamService: SteamService,
  ) {
    this.defineJobs();
    this.defineSteamJobs();
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

  private defineSteamJobs(): void {
    this.agenda.define(
      this.STEAM_JOB_NAME,
      async (job: Job) => {
        const { reminderId, chatId, appId } = job.attrs.data as {
          reminderId: string;
          chatId: number;
          appId: string;
        };

        const reminder = await this.repository.getById(reminderId);
        if (!reminder) {
          logger.warn({ reminderId }, 'Напоминание о выходе игры не найдено в БД, пропускаем');
          return;
        }

        try {
          await this.processSteamRelease(reminder, chatId, appId);
        } catch (error) {
          logger.error(
            { err: error, chatId, reminderId, appId },
            'Ошибка при обработке напоминания о выходе игры',
          );
        }
      },
      { lockLifetime: 60_000 },
    );

    this.agenda.define(
      this.STEAM_CHECK_JOB_NAME,
      async () => {
        try {
          await this.checkSteamReleases();
        } catch (error) {
          logger.error({ err: error }, 'Ошибка ежедневной проверки дат выхода игр');
        }
      },
      { lockLifetime: 300_000 },
    );
  }

  private async processSteamRelease(
    reminder: ReminderDocument,
    chatId: number,
    appId: string,
  ): Promise<void> {
    const reminderId = reminder._id!.toString();
    const gameName = reminder.gameName || 'Игра';
    const subscribers = reminder.subscribers ?? [];

    let info: SteamGameInfo | null = null;
    try {
      info = await this.steamService.getGameInfo(appId);
    } catch (error) {
      logger.warn(
        { err: error, appId, reminderId },
        'Не удалось получить свежие данные Steam при срабатывании напоминания',
      );
    }

    const newParts =
      info && info.releaseDate ? this.steamService.parseReleaseDateParts(info.releaseDate) : null;
    const today = this.getTodayParts();

    if (info && info.isComingSoon && newParts && this.isDateAfter(newParts, today)) {
      const runAt = this.steamReleaseRunAt(newParts);
      await this.sendRichWithFallback(
        chatId,
        this.buildSteamDelayMessage(gameName, appId, subscribers, newParts),
      );
      await this.sendSteamGameInfo(chatId, info);
      await this.rescheduleSteamReminder(reminderId, chatId, appId, runAt, {
        gameName: info.gameName,
      });
      return;
    }

    if (
      info &&
      info.isComingSoon &&
      newParts &&
      this.isSameDate(newParts, today) &&
      this.getNowHourMsk() < STEAM_RELEASE_RETRY_HOUR
    ) {
      const runAt = this.wallClockInstant(
        today.day,
        today.month,
        today.year,
        STEAM_RELEASE_RETRY_HOUR,
      );
      await this.rescheduleSteamReminder(reminderId, chatId, appId, runAt);
      return;
    }

    if (info && info.isComingSoon && !newParts) {
      await this.sendRichWithFallback(
        chatId,
        this.buildSteamNoDateMessage(gameName, appId, subscribers),
      );
      await this.sendSteamGameInfo(chatId, info);
      await this.deleteSteamReminder(reminderId);
      return;
    }

    await this.sendRichWithFallback(
      chatId,
      this.buildSteamReleaseMessage(gameName, appId, subscribers),
    );
    if (info) {
      await this.sendSteamGameInfo(chatId, info);
    }
    await this.deleteSteamReminder(reminderId);
  }

  private async checkSteamReleases(): Promise<void> {
    const reminders = await this.repository.getAllSteamReleaseReminders();
    if (reminders.length === 0) return;

    logger.info({ total: reminders.length }, 'Ежедневная проверка дат выхода игр');

    for (const reminder of reminders) {
      const reminderId = reminder._id!.toString();
      const appId = reminder.steamAppId;
      if (!appId) continue;

      try {
        if (this.isScheduledToday(reminder.time)) continue;

        const info = await this.steamService.getGameInfo(appId);

        if (!info.isComingSoon) {
          await this.sendRichWithFallback(
            reminder.chatId,
            this.buildSteamReleaseMessage(
              info.gameName || reminder.gameName || 'Игра',
              appId,
              reminder.subscribers ?? [],
              true,
            ),
          );
          await this.sendSteamGameInfo(reminder.chatId, info);
          await this.deleteSteamReminder(reminderId);
          continue;
        }

        const newParts = info.releaseDate
          ? this.steamService.parseReleaseDateParts(info.releaseDate)
          : null;
        if (!newParts) continue;

        const scheduledParts = this.scheduledReleaseParts(reminder.time);
        if (!scheduledParts || this.isSameDate(newParts, scheduledParts)) continue;

        if (!this.isDateAfter(newParts, this.getTodayParts())) continue;

        const runAt = this.steamReleaseRunAt(newParts);
        await this.sendRichWithFallback(
          reminder.chatId,
          this.buildSteamDelayMessage(
            info.gameName || reminder.gameName || 'Игра',
            appId,
            reminder.subscribers ?? [],
            newParts,
          ),
        );
        await this.sendSteamGameInfo(reminder.chatId, info);
        await this.rescheduleSteamReminder(reminderId, reminder.chatId, appId, runAt, {
          gameName: info.gameName,
        });
      } catch (error) {
        logger.error({ err: error, reminderId, appId }, 'Ошибка проверки даты выхода игры');
      }
    }
  }

  public async scheduleSteamCheckJob(): Promise<void> {
    await this.agenda.cancel({ name: this.STEAM_CHECK_JOB_NAME });
    const job = this.agenda.create(this.STEAM_CHECK_JOB_NAME);
    job.repeatEvery(this.STEAM_CHECK_CRON, { timezone: STEAM_RELEASE_TIMEZONE });
    await job.save();
    logger.info('Ежедневная проверка дат выхода игр запланирована');
  }

  public async subscribeToSteamRelease(
    chatId: number,
    subscriber: SteamSubscriber,
    appId: string,
    gameName: string,
    releaseParts: SteamReleaseDateParts,
  ): Promise<SteamSubscribeResult> {
    const existing = await this.repository.findSteamReleaseReminder(chatId, appId);
    if (existing) {
      const alreadySubscribed = (existing.subscribers ?? []).some((s) => s.id === subscriber.id);
      if (alreadySubscribed) return 'already';

      await this.repository.addSubscriber(existing._id!.toString(), subscriber);
      return 'added';
    }

    const runAt = this.steamReleaseRunAt(releaseParts);
    const reminderDoc = await this.repository.create({
      chatId,
      kind: 'steam_release',
      message: `🎮 Выход игры: ${gameName}`,
      frequency: 'once',
      time: runAt.toISOString(),
      timezone: STEAM_RELEASE_TIMEZONE,
      silent: true,
      steamAppId: appId,
      gameName,
      subscribers: [subscriber],
      createdAt: new Date(),
      createdBy: subscriber.id,
      creatorFirstName: subscriber.firstName,
      creatorUsername: subscriber.username,
    });

    const reminderId = reminderDoc._id!.toString();

    try {
      await this.scheduleSteamJob(reminderId, chatId, appId, runAt);
    } catch (error) {
      logger.error(
        { err: error, chatId, appId },
        'Не удалось запланировать напоминание о выходе игры',
      );
      await this.repository.delete(reminderId);
      throw new Error('Ошибка планирования напоминания');
    }

    return 'created';
  }

  private async scheduleSteamJob(
    reminderId: string,
    chatId: number,
    appId: string,
    runAt: Date,
  ): Promise<void> {
    const job = this.agenda.create(this.STEAM_JOB_NAME, { reminderId, chatId, appId });
    job.unique({ 'data.reminderId': reminderId });
    job.schedule(runAt);
    await job.save();
  }

  private async rescheduleSteamReminder(
    reminderId: string,
    chatId: number,
    appId: string,
    runAt: Date,
    extraUpdate: Partial<ReminderDocument> = {},
  ): Promise<void> {
    await this.repository.update(reminderId, { time: runAt.toISOString(), ...extraUpdate });
    await this.cancelJob(reminderId);
    await this.scheduleSteamJob(reminderId, chatId, appId, runAt);
  }

  private async deleteSteamReminder(reminderId: string): Promise<void> {
    try {
      await this.repository.delete(reminderId);
      await this.cancelJob(reminderId);
    } catch (error) {
      logger.error({ err: error, reminderId }, 'Ошибка при удалении напоминания о выходе игры');
    }
  }

  private async sendSteamGameInfo(chatId: number, info: SteamGameInfo): Promise<void> {
    const message = this.steamService.formatGameMessage(
      info.editions,
      info.subscriptions,
      info.headerImage,
      info.gameName,
      info.hasRussianLanguage,
      info.releaseDate,
      info.isComingSoon,
      info.isGameFree,
    );
    if (!message.trim()) return;
    await this.sendRichWithFallback(chatId, message);
  }

  private buildSteamReleaseMessage(
    gameName: string,
    appId: string,
    subscribers: SteamSubscriber[],
    early = false,
  ): string {
    const heading =
      this.escapeMarkdownText(gameName) + (early ? ' вышла раньше срока!' : ' вышла!');
    const mentions = this.mentionsMarkdown(subscribers);
    const line = mentions
      ? `${mentions}, игра, которую вы отслеживали, уже доступна.`
      : 'Игра, которую вы отслеживали, уже доступна.';

    return [
      `## ${heading}`,
      '',
      line,
      '',
      `[Открыть в Steam](https://store.steampowered.com/app/${appId})`,
    ].join('\n');
  }

  private buildSteamDelayMessage(
    gameName: string,
    appId: string,
    subscribers: SteamSubscriber[],
    newParts: SteamReleaseDateParts,
  ): string {
    const mentions = this.mentionsMarkdown(subscribers);
    const line = `${mentions ? `${mentions}, ` : ''}игра выйдет ${this.formatPartsDateRu(newParts)}. Напомню снова в день выхода.`;

    return [
      `## Дата выхода ${this.escapeMarkdownText(gameName)} перенесена`,
      '',
      line,
      '',
      `[Открыть в Steam](https://store.steampowered.com/app/${appId})`,
    ].join('\n');
  }

  private buildSteamNoDateMessage(
    gameName: string,
    appId: string,
    subscribers: SteamSubscriber[],
  ): string {
    const mentions = this.mentionsMarkdown(subscribers);
    const line = `${mentions ? `${mentions}, ` : ''}точную дату выхода Steam больше не показывает. Проверить актуальную информацию можно на странице игры.`;

    return [
      `## Дата выхода ${this.escapeMarkdownText(gameName)} пока неизвестна`,
      '',
      line,
      '',
      `[Открыть в Steam](https://store.steampowered.com/app/${appId})`,
    ].join('\n');
  }

  private mentionsMarkdown(subscribers: SteamSubscriber[]): string {
    return subscribers
      .map((s) => `[${this.escapeMarkdownText(s.firstName || 'Игрок')}](tg://user?id=${s.id})`)
      .join(', ');
  }

  private escapeMarkdownText(text: string): string {
    return text.replace(/([_*[\]()`~#>\\])/g, '\\$1');
  }

  private formatPartsDateRu(parts: SteamReleaseDateParts): string {
    return new Date(parts.year, parts.month - 1, parts.day).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  private steamReleaseRunAt(parts: SteamReleaseDateParts): Date {
    const runAt = this.wallClockInstant(parts.day, parts.month, parts.year, STEAM_RELEASE_HOUR);
    if (runAt.getTime() <= Date.now()) {
      return new Date(Date.now() + 60_000);
    }
    return runAt;
  }

  private wallClockInstant(day: number, month: number, year: number, hours: number): Date {
    const wallAsUtc = Date.UTC(year, month - 1, day, hours, 0, 0, 0);
    const offsetMs = this.getTzOffsetMs(new Date(wallAsUtc), STEAM_RELEASE_TIMEZONE);
    return new Date(wallAsUtc - offsetMs);
  }

  private getTodayParts(): SteamReleaseDateParts {
    const parts = this.getTzParts(new Date(), STEAM_RELEASE_TIMEZONE);
    return { day: parts.d, month: parts.m, year: parts.y };
  }

  private getNowHourMsk(): number {
    return this.getTzParts(new Date(), STEAM_RELEASE_TIMEZONE).h;
  }

  private scheduledReleaseParts(time: string): SteamReleaseDateParts | null {
    const instant = new Date(time);
    if (Number.isNaN(instant.getTime())) return null;
    const parts = this.getTzParts(instant, STEAM_RELEASE_TIMEZONE);
    return { day: parts.d, month: parts.m, year: parts.y };
  }

  private isScheduledToday(time: string): boolean {
    const parts = this.scheduledReleaseParts(time);
    if (!parts) return false;
    return this.isSameDate(parts, this.getTodayParts());
  }

  private isSameDate(a: SteamReleaseDateParts, b: SteamReleaseDateParts): boolean {
    return a.day === b.day && a.month === b.month && a.year === b.year;
  }

  private isDateAfter(a: SteamReleaseDateParts, b: SteamReleaseDateParts): boolean {
    if (a.year !== b.year) return a.year > b.year;
    if (a.month !== b.month) return a.month > b.month;
    return a.day > b.day;
  }

  private buildPlainText(reminder: ReminderDocument): string {
    if (reminder.silent) return reminder.message;
    const mention = reminder.creatorUsername
      ? `@${reminder.creatorUsername}`
      : reminder.creatorFirstName;
    return `${mention},\n\n${reminder.message}`;
  }

  private async sendReminder(reminder: ReminderDocument, chatId: number): Promise<void> {
    await this.sendRichWithFallback(chatId, this.buildPlainText(reminder));
  }

  private async sendRichWithFallback(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.api.sendRichMessage(chatId, { markdown: text });
      return;
    } catch (error) {
      if (!(error instanceof GrammyError && error.error_code === 400)) {
        throw error;
      }
      logger.warn({ err: error, chatId }, 'Rich-отправка не удалась (400), fallback на plain text');
    }

    await this.bot.api.sendMessage(chatId, text);
  }

  private cancelJob(reminderId: string): Promise<number> {
    return this.agenda.cancel({ data: { reminderId } });
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

    if (oldReminder.kind === 'steam_release') {
      throw new Error('Напоминания о выходе игры нельзя редактировать');
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
    const agendaJobs = await this.repository.getAgendaJobs();

    const reminderIds = new Set(reminders.map((reminder) => reminder._id!.toString()));
    const jobsByReminderId = new Map(agendaJobs.map((job) => [job.reminderId, job]));

    let created = 0;
    let repaired = 0;

    for (const reminder of reminders) {
      const reminderId = reminder._id!.toString();
      const existing = jobsByReminderId.get(reminderId);

      const needsRepair =
        !existing ||
        existing.name !== this.getJobNameForReminder(reminder) ||
        existing.nextRunAt === null;

      if (!needsRepair) continue;

      if (existing) {
        try {
          await this.cancelJob(reminderId);
        } catch (error) {
          logger.error({ err: error, reminderId }, 'Не удалось удалить «мёртвый» джоб');
        }
      }

      try {
        await this.scheduleJobForReminder(reminder);
        if (existing) {
          repaired++;
        } else {
          created++;
        }
      } catch (error) {
        logger.error({ err: error, reminderId }, 'Не удалось запланировать напоминание при сверке');
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

  private getJobNameForReminder(reminder: ReminderDocument): string {
    return reminder.kind === 'steam_release' ? this.STEAM_JOB_NAME : this.JOB_NAME;
  }

  private async scheduleJobForReminder(reminder: ReminderDocument): Promise<void> {
    const reminderId = reminder._id!.toString();

    if (reminder.kind === 'steam_release') {
      if (!reminder.steamAppId) {
        logger.warn({ reminderId }, 'У напоминания о выходе игры нет steamAppId, пропускаем');
        return;
      }
      const runAt = new Date(reminder.time);
      this.assertValidDate(runAt, reminder.time);
      await this.scheduleSteamJob(reminderId, reminder.chatId, reminder.steamAppId, runAt);
      return;
    }

    await this.scheduleJob(reminderId, reminder.chatId, reminder);
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
