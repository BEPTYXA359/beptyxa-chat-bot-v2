import { Agenda, Job } from 'agenda';
import { InlineKeyboard, Bot } from 'grammy';
import { ObjectId } from 'mongodb';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionSettingsRepository } from './subscription-settings.repository';
import {
  CreateSubscriptionDto,
  DEFAULT_SUBSCRIPTION_CURRENCY,
  SubscriptionDocument,
  SubscriptionSettingsDocument,
} from './subscription.types';
import { TelegramUser } from '../../shared/types/telegram.types';
import { BotContext } from '../../bot/bot.types';
import { CurrencyService } from '../currency/currency.service';
import { logger } from '../../shared/logger';
import {
  addPeriod,
  diffDaysBetweenDateStrings,
  formatDateRu,
  MSK_TIMEZONE,
  rollForwardPeriod,
  todayDateString,
} from '../../shared/utils/timezone.util';

const SUBSCRIPTION_CHECK_HOUR = 20;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Подписка не найдена');
    this.name = 'SubscriptionNotFoundError';
  }
}

export class InvalidSubscriptionCurrencyError extends Error {
  constructor(currency: string) {
    super(`Неизвестная валюта: ${currency}`);
    this.name = 'InvalidSubscriptionCurrencyError';
  }
}

export class CurrencyRatesUnavailableError extends Error {
  constructor() {
    super('Курсы валют ещё не загружены, попробуйте позже');
    this.name = 'CurrencyRatesUnavailableError';
  }
}

export class SubscriptionService {
  private readonly CHECK_JOB_NAME = 'check_subscriptions';
  private readonly CHECK_CRON = `0 ${SUBSCRIPTION_CHECK_HOUR} * * *`;

  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly settingsRepository: SubscriptionSettingsRepository,
    private readonly agenda: Agenda,
    private readonly bot: Bot<BotContext>,
    private readonly currencyService: CurrencyService,
  ) {
    this.defineJobs();
  }

  private defineJobs(): void {
    this.agenda.define(
      this.CHECK_JOB_NAME,
      async (_job: Job) => {
        try {
          await this.checkSubscriptions();
        } catch (error) {
          logger.error({ err: error }, 'Ошибка ежедневной проверки подписок');
        }
      },
      { lockLifetime: 300_000 },
    );
  }

  public async scheduleSubscriptionCheckJob(): Promise<void> {
    await this.agenda.cancel({ name: this.CHECK_JOB_NAME });
    const job = this.agenda.create(this.CHECK_JOB_NAME);
    job.repeatEvery(this.CHECK_CRON, { timezone: MSK_TIMEZONE });
    await job.save();
    logger.info('Ежедневная проверка подписок запланирована');
  }

  public async getSubscriptions(chatId: number): Promise<SubscriptionDocument[]> {
    return this.repository.getByChat(chatId);
  }

  public async createSubscription(
    chatId: number,
    creator: TelegramUser,
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    this.assertCurrencySupported(dto.currency);

    return this.repository.create({
      chatId,
      name: dto.name,
      service: dto.service,
      cost: dto.cost,
      currency: dto.currency,
      period: dto.period,
      nextPaymentDate: dto.nextPaymentDate,
      remindDaysBefore: dto.remindDaysBefore,
      notificationsEnabled: dto.notificationsEnabled,
      status: dto.status,
      color: dto.color,
      createdAt: new Date(),
      createdBy: creator.id,
      creatorFirstName: creator.first_name,
      creatorUsername: creator.username,
    });
  }

  public async updateSubscription(
    subscriptionId: string,
    chatId: number,
    dto: CreateSubscriptionDto,
  ): Promise<void> {
    await this.findOwnedSubscription(subscriptionId, chatId);

    this.assertCurrencySupported(dto.currency);

    await this.repository.update(subscriptionId, {
      name: dto.name,
      service: dto.service,
      cost: dto.cost,
      currency: dto.currency,
      period: dto.period,
      nextPaymentDate: dto.nextPaymentDate,
      remindDaysBefore: dto.remindDaysBefore,
      notificationsEnabled: dto.notificationsEnabled,
      status: dto.status,
      color: dto.color,
      updatedAt: new Date(),
    });
  }

  public async deleteSubscription(subscriptionId: string, chatId: number): Promise<void> {
    await this.findOwnedSubscription(subscriptionId, chatId);
    await this.repository.delete(subscriptionId);
  }

  public async getSettings(chatId: number): Promise<{ baseCurrency: string }> {
    const settings = await this.settingsRepository.getByChat(chatId);
    return { baseCurrency: settings?.baseCurrency ?? DEFAULT_SUBSCRIPTION_CURRENCY };
  }

  public async updateSettings(
    chatId: number,
    baseCurrency: string,
  ): Promise<SubscriptionSettingsDocument> {
    this.assertCurrencySupported(baseCurrency);
    return this.settingsRepository.upsertBaseCurrency(chatId, baseCurrency);
  }

  /** Кнопка «Оплачено» в уведомлении: сдвигает дату следующего списания */
  public async markPaid(subscriptionId: string, chatId: number): Promise<string> {
    const subscription = await this.findOwnedSubscription(subscriptionId, chatId);

    const today = todayDateString();
    const next = rollForwardPeriod(
      addPeriod(subscription.nextPaymentDate, subscription.period),
      subscription.period,
      today,
    );
    await this.repository.update(subscriptionId, { nextPaymentDate: next });
    return next;
  }

  /** Кнопка «Без напоминаний» в уведомлении */
  public async disableNotifications(subscriptionId: string, chatId: number): Promise<void> {
    await this.findOwnedSubscription(subscriptionId, chatId);
    await this.repository.update(subscriptionId, { notificationsEnabled: false });
  }

  public async checkSubscriptions(): Promise<void> {
    const today = todayDateString();
    const subscriptions = await this.repository.getAll();
    if (subscriptions.length === 0) return;

    logger.info({ total: subscriptions.length }, 'Ежедневная проверка подписок');

    for (const subscription of subscriptions) {
      const subscriptionId = subscription._id!.toString();
      try {
        if (subscription.status === 'paused') continue;

        if (subscription.nextPaymentDate < today) {
          const next = rollForwardPeriod(subscription.nextPaymentDate, subscription.period, today);
          await this.repository.update(subscriptionId, { nextPaymentDate: next });
          continue;
        }

        const daysLeft = diffDaysBetweenDateStrings(today, subscription.nextPaymentDate);
        if (subscription.notificationsEnabled && daysLeft === subscription.remindDaysBefore) {
          await this.sendChargeReminder(subscription, daysLeft);
        }
      } catch (error) {
        logger.error({ err: error, subscriptionId }, 'Ошибка обработки подписки');
      }
    }
  }

  /** Откатывает устаревшие даты при старте без рассылки уведомлений */
  public async repairSubscriptions(): Promise<void> {
    const today = todayDateString();
    const subscriptions = await this.repository.getAll();

    let repaired = 0;
    for (const subscription of subscriptions) {
      if (subscription.status === 'paused') continue;
      if (subscription.nextPaymentDate >= today) continue;

      const next = rollForwardPeriod(subscription.nextPaymentDate, subscription.period, today);
      await this.repository.update(subscription._id!.toString(), { nextPaymentDate: next });
      repaired++;
    }

    if (repaired > 0) {
      logger.info({ repaired }, 'Даты подписок переведены на следующий период при старте');
    }
  }

  private async sendChargeReminder(
    subscription: SubscriptionDocument,
    daysLeft: number,
  ): Promise<void> {
    const priceParts = [this.formatMoney(subscription.cost, subscription.currency)];
    if (subscription.currency !== 'RUB') {
      const approx = this.approximateRub(subscription.cost, subscription.currency);
      if (approx) priceParts.push(approx);
    }
    const price = priceParts.join(' ≈ ');

    const when = daysLeft === 1 ? 'завтра' : `через ${daysLeft} ${this.pluralDays(daysLeft)}`;
    const serviceName = subscription.service
      ? `${subscription.name} (${subscription.service})`
      : subscription.name;

    const text = [
      '🔔 Напоминание о подписке',
      '',
      `«${serviceName}» — списание ${when}, ${formatDateRu(subscription.nextPaymentDate)}`,
      price,
    ].join('\n');

    const keyboard = new InlineKeyboard()
      .text('✅ Оплачено', `sub_paid:${subscription._id!.toString()}`)
      .text('🔕 Без напоминаний', `sub_mute:${subscription._id!.toString()}`);

    await this.bot.api.sendMessage(subscription.chatId, text, { reply_markup: keyboard });
  }

  /** Загружает подписку чата; невалидный id и чужая подписка — одинаково «не найдена» */
  private async findOwnedSubscription(
    subscriptionId: string,
    chatId: number,
  ): Promise<SubscriptionDocument> {
    if (!OBJECT_ID_REGEX.test(subscriptionId) || !ObjectId.isValid(subscriptionId)) {
      throw new SubscriptionNotFoundError();
    }

    const subscription = await this.repository.getById(subscriptionId);
    if (!subscription || subscription.chatId !== chatId) {
      throw new SubscriptionNotFoundError();
    }
    return subscription;
  }

  private assertCurrencySupported(currency: string): void {
    if (!this.currencyService.getRates()) {
      throw new CurrencyRatesUnavailableError();
    }
    try {
      this.currencyService.convert(1, currency, 'RUB');
    } catch {
      throw new InvalidSubscriptionCurrencyError(currency);
    }
  }

  private approximateRub(amount: number, currency: string): string | null {
    try {
      const rub = this.currencyService.convert(amount, currency, 'RUB');
      return this.formatMoney(rub, 'RUB');
    } catch {
      return null;
    }
  }

  private formatMoney(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount} ${currency}`;
    }
  }

  private pluralDays(days: number): string {
    const mod10 = days % 10;
    const mod100 = days % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
    return 'дней';
  }
}
