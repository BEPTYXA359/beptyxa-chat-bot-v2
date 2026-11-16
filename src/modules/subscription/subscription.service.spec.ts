import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Agenda } from 'agenda';
import type { Bot } from 'grammy';
import type { SubscriptionRepository } from './subscription.repository';
import type { SubscriptionSettingsRepository } from './subscription-settings.repository';
import type { CurrencyService } from '../currency/currency.service';
import type { ConversionSettingsService } from '../conversion/conversion-settings.service';
import type { BotContext } from '../../bot/bot.types';
import type { SubscriptionDocument } from './subscription.types';

process.env.NODE_ENV = 'development';
const { SubscriptionService } = await import('./subscription.service');

function subscription(patch: Partial<SubscriptionDocument> = {}): SubscriptionDocument {
  return {
    _id: new ObjectId(),
    chatId: -100,
    name: 'Service',
    cost: 100,
    currency: 'RUB',
    period: 'month',
    nextPaymentDate: '2026-11-14',
    remindDaysBefore: 3,
    notificationsEnabled: true,
    status: 'active',
    createdAt: new Date(),
    createdBy: 111,
    creatorFirstName: 'Test',
    ...patch,
  };
}

function createService(
  document: SubscriptionDocument,
  sendMessage = vi.fn().mockResolvedValue({}),
) {
  const repository = {
    getAll: vi.fn().mockResolvedValue([document]),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const agenda = { define: vi.fn() };
  const service = new SubscriptionService(
    repository as unknown as SubscriptionRepository,
    {} as SubscriptionSettingsRepository,
    agenda as unknown as Agenda,
    { api: { sendMessage } } as unknown as Bot<BotContext>,
    {} as CurrencyService,
    {} as ConversionSettingsService,
  );
  return { service, repository, sendMessage };
}

describe('напоминания о подписках', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('отправляет пропущенное уведомление, пока платёж остаётся внутри окна', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const { service, sendMessage } = createService(subscription());

    await service.checkSubscriptions();

    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('не отправляет повторное уведомление для того же платежа', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const { service, sendMessage } = createService(
      subscription({ lastReminderPaymentDate: '2026-11-14' }),
    );

    await service.checkSubscriptions();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('переносит просроченный платёж без позднего уведомления', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const { service, repository, sendMessage } = createService(
      subscription({ nextPaymentDate: '2026-11-10' }),
    );

    await service.checkSubscriptions();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(expect.any(String), {
      nextPaymentDate: '2026-12-10',
      lastReminderPaymentDate: '',
    });
  });

  it('не помечает уведомление отправленным после ошибки Telegram', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const { service, repository } = createService(
      subscription(),
      vi.fn().mockRejectedValue(new Error('telegram timeout')),
    );

    await service.checkSubscriptions();

    expect(repository.update).not.toHaveBeenCalled();
  });
});
