import { Bot, HearsContext } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { logger } from '../../shared/logger';
import { formatForTelegram, splitMessage } from '../../shared/utils/text.util';
import { GPTProvider } from './chat.types';

export const setupChatCommands = (bot: Bot<BotContext>) => {
  bot.hears(/^чатгпт\s+(.+)/i, async (ctx) => {
    await makeLlmAnswer(ctx, 'OpenAi');
  });

  bot.hears(/^грок\s+(.+)/i, async (ctx) => {
    await makeLlmAnswer(ctx, 'Groq');
  });

  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id;

    const settings = await ctx.services.chat.recordChatterboxHistory(chatId, text);

    if (settings && settings.isChatterboxEnabled) {
      const chance = settings.chatterboxChance ?? 0.02;

      if (Math.random() < chance) {
        try {
          await ctx.replyWithChatAction('typing');

          const reply = await ctx.services.chat.triggerChatterboxReply(chatId, text);

          if (reply) {
            await ctx.reply(reply, {
              reply_parameters: { message_id: ctx.msg.message_id },
            });
          }
        } catch (error) {
          logger.error({ err: error }, 'Ошибка chatterbox');
        }
      }
    }
    await next();
  });
};

const makeLlmAnswer = async (ctx: HearsContext<BotContext>, provider: GPTProvider) => {
  const prompt = ctx.match[1];

  try {
    await ctx.replyWithChatAction('typing');
    const reply = await ctx.services.chat.processGptRequest(ctx.chat.id, prompt, provider);

    const messages = splitMessage(reply);

    for (const msg of messages) {
      const formattedMsg = formatForTelegram(msg);
      try {
        await ctx.reply(formattedMsg, {
          parse_mode: 'MarkdownV2',
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      } catch (error) {
        await ctx.reply(msg, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
        logger.error({ err: error }, `Ошибка при отправке MarkdownV2 от ${provider}`);
      }
    }
  } catch (error) {
    logger.error({ err: error }, `Критическая ошибка команды ${provider}`);
    await ctx.reply(`Произошла ошибка при обращении к ${provider}`);
  }
};
