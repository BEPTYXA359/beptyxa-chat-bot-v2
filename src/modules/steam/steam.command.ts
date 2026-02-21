import { Bot } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { logger } from '../../shared/logger';

const STEAM_LINK_REGEX = /store\.steampowered\.com\/app\/(\d+)/i;

export const setupSteamCommands = (bot: Bot<BotContext>) => {
  bot.hears(STEAM_LINK_REGEX, async (ctx) => {
    const appId = ctx.match[1];

    if (!appId) return;

    try {
      await ctx.replyWithChatAction('typing');

      const prices = await ctx.services.steam.getGamePricesInfo(appId);

      if (prices.length === 0) {
        await ctx.reply('Цены для этой игры не найдены.', {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
        return;
      }

      await ctx.reply(prices.join('\n'), {
        parse_mode: 'MarkdownV2',
        reply_parameters: { message_id: ctx.msg.message_id },
      });
    } catch (error) {
      logger.error({ err: error }, 'Произошла ошибка при получении данных о стоимости игры');
      await ctx.reply('Произошла ошибка при получении данных о стоимости игры', {
        reply_parameters: { message_id: ctx.msg.message_id },
      });
    }
  });
};
