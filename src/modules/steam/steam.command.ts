import { Bot } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { logger } from '../../shared/logger';

const STEAM_LINK_REGEX = /store\.steampowered\.com\/app\/(\d+)/i;
const STEAM_DLC_REGEX = /^steam_dlc:(\d+)$/;

export const setupSteamCommands = (bot: Bot<BotContext>) => {
  bot.hears(STEAM_LINK_REGEX, async (ctx) => {
    const appId = ctx.match[1];

    if (!appId) return;

    try {
      await ctx.replyWithChatAction('typing');

      const {
        editions,
        subscriptions,
        dlcIds,
        headerImage,
        gameName,
        hasRussianLanguage,
        releaseDate,
        isComingSoon,
        isGameFree,
      } = await ctx.services.steam.getGameInfo(appId);

      const message = ctx.services.steam.formatGameMessage(
        editions,
        subscriptions,
        headerImage,
        gameName,
        hasRussianLanguage,
        releaseDate,
        isComingSoon,
        isGameFree,
      );

      if (!message.trim()) {
        await ctx.reply('Информация о ценах не найдена.', {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
        return;
      }

      const replyMarkup =
        dlcIds.length > 0
          ? {
              inline_keyboard: [
                [{ text: 'Получить цены DLC', callback_data: `steam_dlc:${appId}` }],
              ],
            }
          : undefined;

      await ctx.replyWithRichMessage(
        { markdown: message },
        {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: replyMarkup,
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
      await ctx.editMessageReplyMarkup({
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Обрабатываю цены DLC...', callback_data: `steam_dlc:${appId}` }],
          ],
        },
      });

      const {
        editions,
        subscriptions,
        dlcIds,
        headerImage,
        gameName,
        hasRussianLanguage,
        releaseDate,
        isComingSoon,
        isGameFree,
      } = await ctx.services.steam.getGameInfo(appId);

      if (dlcIds.length === 0) {
        const message = ctx.services.steam.formatGameMessage(
          editions,
          subscriptions,
          headerImage,
          gameName,
          hasRussianLanguage,
          releaseDate,
          isComingSoon,
          isGameFree,
        );

        await ctx.editMessageText({ markdown: message }, { reply_markup: { inline_keyboard: [] } });
        return;
      }

      const dlcs = await ctx.services.steam.getDlcInfo(dlcIds, gameName, async (current, total) => {
        await ctx.editMessageReplyMarkup({
          reply_markup: {
            inline_keyboard: [[
              { text: `Обрабатываю цены DLC... (${current}/${total})`, callback_data: `steam_dlc:${appId}` },
            ]],
          },
        });
      });
      const fullMessage =
        ctx.services.steam.formatGameMessage(
          editions,
          subscriptions,
          headerImage,
          gameName,
          hasRussianLanguage,
          releaseDate,
          isComingSoon,
          isGameFree,
        ) + ctx.services.steam.formatDlcTable(dlcs);

      await ctx.editMessageText(
        { markdown: fullMessage },
        { reply_markup: { inline_keyboard: [] } },
      );
    } catch (error) {
      logger.error({ err: error, appId }, 'Ошибка при получении DLC через callback');
      await ctx.editMessageReplyMarkup({
        reply_markup: {
          inline_keyboard: [[{ text: 'Получить цены DLC', callback_data: `steam_dlc:${appId}` }]],
        },
      });
    }
  });
};
