import { Bot, GrammyError } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { SubscriptionService, SubscriptionNotFoundError } from './subscription.service';
import { formatDateRu } from '../../shared/utils/timezone.util';
import { logger } from '../../shared/logger';

/** Повторное нажатие по кнопке шлёт тот же edit — Telegram отвечает «not modified», это не ошибка */
const isMessageNotModified = (error: unknown): boolean =>
  error instanceof GrammyError && error.description.includes('message is not modified');

export function setupSubscriptionCallbacks(
  bot: Bot<BotContext>,
  subscriptionService: SubscriptionService,
): void {
  bot.callbackQuery(/^sub_paid:(.+)$/, async (ctx) => {
    const subscriptionId = ctx.match[1];
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      const nextDate = await subscriptionService.markPaid(subscriptionId, chatId);
      const sourceText = ctx.msg?.text ?? 'Напоминание о подписке';
      await ctx.editMessageText(
        `${sourceText}\n\n✅ Отмечено оплаченным. Следующее списание ${formatDateRu(nextDate)}`,
      );
      await ctx.answerCallbackQuery({ text: `Следующее списание ${formatDateRu(nextDate)}` });
    } catch (error) {
      if (isMessageNotModified(error)) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (error instanceof SubscriptionNotFoundError) {
        await ctx.answerCallbackQuery({ text: error.message, show_alert: true });
        return;
      }
      logger.error({ err: error, subscriptionId, chatId }, 'Ошибка обработки «Оплачено»');
      await ctx.answerCallbackQuery({ text: 'Произошла ошибка', show_alert: true });
    }
  });

  bot.callbackQuery(/^sub_mute:(.+)$/, async (ctx) => {
    const subscriptionId = ctx.match[1];
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      await subscriptionService.disableNotifications(subscriptionId, chatId);
      const sourceText = ctx.msg?.text ?? 'Напоминание о подписке';
      await ctx.editMessageText(`${sourceText}\n\n🔕 Напоминания по этой подписке отключены`);
      await ctx.answerCallbackQuery({ text: 'Напоминания отключены' });
    } catch (error) {
      if (isMessageNotModified(error)) {
        await ctx.answerCallbackQuery();
        return;
      }
      if (error instanceof SubscriptionNotFoundError) {
        await ctx.answerCallbackQuery({ text: error.message, show_alert: true });
        return;
      }
      logger.error({ err: error, subscriptionId, chatId }, 'Ошибка обработки «Без напоминаний»');
      await ctx.answerCallbackQuery({ text: 'Произошла ошибка', show_alert: true });
    }
  });
}
