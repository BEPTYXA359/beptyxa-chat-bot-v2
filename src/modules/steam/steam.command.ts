import { Bot } from 'grammy';
import type { InlineKeyboardMarkup } from '@grammyjs/types';
import { BotContext } from '../../bot/bot.types';
import { logger } from '../../shared/logger';
import { ReminderService } from '../reminder/reminder.service';
import { SteamService } from './steam.service';

const STEAM_LINK_REGEX = /store\.steampowered\.com\/app\/(\d+)/i;
const STEAM_DLC_REGEX = /^steam_dlc:(\d+)$/;
const STEAM_REMINDER_REGEX = /^steam_reminder:(\d+)$/;

type GameInfo = Awaited<ReturnType<SteamService['getGameInfo']>>;
type KeyboardRow = InlineKeyboardMarkup['inline_keyboard'][number];

const rowHasCallbackData = (row: KeyboardRow, callbackData: string): boolean =>
  row.some((button) => 'callback_data' in button && button.callback_data === callbackData);

const buildGameKeyboard = (
  steam: SteamService,
  appId: string,
  info: Pick<GameInfo, 'releaseDate' | 'isComingSoon' | 'dlcIds'>,
  options?: { includeDlc?: boolean },
) => {
  const rows: { text: string; callback_data: string }[][] = [];

  const releaseParts = info.releaseDate ? steam.parseReleaseDateParts(info.releaseDate) : null;
  if (info.isComingSoon && releaseParts) {
    rows.push([{ text: '🔔 Напомнить о выходе', callback_data: `steam_reminder:${appId}` }]);
  }

  if (options?.includeDlc !== false && info.dlcIds.length > 0) {
    rows.push([{ text: 'Получить цены DLC', callback_data: `steam_dlc:${appId}` }]);
  }

  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
};

export const setupSteamCommands = (bot: Bot<BotContext>, reminderService: ReminderService) => {
  bot.hears(STEAM_LINK_REGEX, async (ctx) => {
    const appId = ctx.match[1];

    if (!appId) return;

    try {
      await ctx.replyWithChatAction('typing');

      const info = await ctx.services.steam.getGameInfo(appId);
      const bundles = await ctx.services.steam.getBundlesInfo(appId, info.gameName);

      const bundlesSection =
        bundles.length > 0 ? ctx.services.steam.formatBundlesTable(bundles) : '';
      const message =
        ctx.services.steam.formatGameMessage(
          info.editions,
          info.subscriptions,
          info.headerImage,
          info.gameName,
          info.hasRussianLanguage,
          info.releaseDate,
          info.isComingSoon,
          info.isGameFree,
        ) + bundlesSection;

      if (!message.trim()) {
        await ctx.reply('Информация о ценах не найдена.', {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
        return;
      }

      await ctx.replyWithRichMessage(
        { markdown: message },
        {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: buildGameKeyboard(ctx.services.steam, appId, info),
        },
      );
    } catch (error) {
      logger.error({ err: error }, 'Произошла ошибка при получении данных о стоимости игры');
      await ctx.reply('Произошла ошибка при получении данных о стоимости игры', {
        reply_parameters: { message_id: ctx.msg.message_id },
      });
    }
  });

  bot.callbackQuery(STEAM_DLC_REGEX, async (ctx) => {
    const appId = ctx.match[1];

    if (!appId) {
      await ctx.answerCallbackQuery({ text: 'Ошибка: appId не найден' });
      return;
    }

    try {
      await ctx.answerCallbackQuery({ text: 'Получаю цены DLC...' });

      const reminderRow = ctx.callbackQuery.message?.reply_markup?.inline_keyboard.find((row) =>
        rowHasCallbackData(row, `steam_reminder:${appId}`),
      );
      const progressKeyboard = [
        ...(reminderRow ? [reminderRow] : []),
        [{ text: 'Обрабатываю цены DLC...', callback_data: `steam_dlc:${appId}` }],
      ];
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: progressKeyboard } });

      const info = await ctx.services.steam.getGameInfo(appId);

      const formatMainMessage = () =>
        ctx.services.steam.formatGameMessage(
          info.editions,
          info.subscriptions,
          info.headerImage,
          info.gameName,
          info.hasRussianLanguage,
          info.releaseDate,
          info.isComingSoon,
          info.isGameFree,
        );

      // бандлы показываются в карточке сразу — при пересборке держим секцию перед DLC
      const bundles = await ctx.services.steam.getBundlesInfo(appId, info.gameName);
      const bundlesSection =
        bundles.length > 0 ? ctx.services.steam.formatBundlesTable(bundles) : '';

      if (info.dlcIds.length === 0) {
        await ctx.editMessageText(
          { markdown: formatMainMessage() + bundlesSection },
          {
            reply_markup: buildGameKeyboard(ctx.services.steam, appId, info, {
              includeDlc: false,
            }) ?? { inline_keyboard: [] },
          },
        );
        return;
      }

      const dlcs = await ctx.services.steam.getDlcInfo(
        info.dlcIds,
        info.gameName,
        async (current, total) => {
          await ctx.editMessageReplyMarkup({
            reply_markup: {
              inline_keyboard: [
                ...(reminderRow ? [reminderRow] : []),
                [
                  {
                    text: `Обрабатываю цены DLC... (${current}/${total})`,
                    callback_data: `steam_dlc:${appId}`,
                  },
                ],
              ],
            },
          });
        },
      );

      const fullMessage =
        formatMainMessage() + bundlesSection + ctx.services.steam.formatDlcTable(dlcs);

      await ctx.editMessageText(
        { markdown: fullMessage },
        {
          reply_markup: buildGameKeyboard(ctx.services.steam, appId, info, {
            includeDlc: false,
          }) ?? { inline_keyboard: [] },
        },
      );
    } catch (error) {
      logger.error({ err: error, appId }, 'Ошибка при получении DLC через callback');
      const keyboard = ctx.callbackQuery.message?.reply_markup?.inline_keyboard;
      const restoreReminderRow = keyboard?.find((row) =>
        rowHasCallbackData(row, `steam_reminder:${appId}`),
      );
      await ctx.editMessageReplyMarkup({
        reply_markup: {
          inline_keyboard: [
            ...(restoreReminderRow ? [restoreReminderRow] : []),
            [{ text: 'Получить цены DLC', callback_data: `steam_dlc:${appId}` }],
          ],
        },
      });
    }
  });

  bot.callbackQuery(STEAM_REMINDER_REGEX, async (ctx) => {
    const appId = ctx.match[1];

    if (!appId) {
      await ctx.answerCallbackQuery({ text: 'Ошибка: appId не найден' });
      return;
    }

    try {
      const info = await ctx.services.steam.getGameInfo(appId);
      const releaseParts = info.releaseDate
        ? ctx.services.steam.parseReleaseDateParts(info.releaseDate)
        : null;

      if (!info.isComingSoon || !releaseParts) {
        await ctx.answerCallbackQuery({
          text: info.isComingSoon ? 'У игры нет конкретной даты выхода' : 'Игра уже вышла 🎉',
        });

        const keyboard = ctx.callbackQuery.message?.reply_markup?.inline_keyboard;
        if (keyboard) {
          const filtered = keyboard.filter(
            (row) => !rowHasCallbackData(row, `steam_reminder:${appId}`),
          );
          try {
            await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: filtered } });
          } catch (error) {
            logger.warn({ err: error, appId }, 'Не удалось убрать кнопку напоминания');
          }
        }
        return;
      }

      const result = await reminderService.subscribeToSteamRelease(
        ctx.chat?.id ?? ctx.from.id,
        {
          id: ctx.from.id,
          firstName: ctx.from.first_name,
          username: ctx.from.username,
        },
        appId,
        info.gameName,
        releaseParts,
      );

      if (result === 'already') {
        await ctx.answerCallbackQuery({ text: 'Вы уже подписаны на это напоминание' });
        return;
      }

      await ctx.answerCallbackQuery({ text: '✅ Напомню о выходе! 🎮' });
    } catch (error) {
      logger.error({ err: error, appId }, 'Ошибка при подписке на напоминание о выходе игры');
      await ctx.answerCallbackQuery({ text: 'Не удалось создать напоминание' });
    }
  });
};
