import { Bot } from 'grammy';
import { BotContext } from '../../bot/bot.types';
import { logger } from '../../shared/logger';
import { splitMessage } from '../../shared/utils/text.util';
import { convertLatexToRichMarkdown, mapLatexStream } from '../../shared/utils/math-converter.util';
import { GPTProvider } from './chat.types';
import { config } from '../../shared/config';
import {
  getProviderDef,
  CHAT_TRIGGER_PROVIDERS,
} from '../../infrastructure/llm/llm-providers.registry';
import { detectLlmTrigger, matchChatterboxTrigger } from './llm-triggers.util';
import { ChatDocument } from './chat.types';

const CHATTERBOX_DEFAULT_TRIGGER = 'балабол';

export const setupChatCommands = (bot: Bot<BotContext>) => {
  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id;

    const chat = await ctx.services.chat.peekChat(chatId);

    const trigger = detectLlmTrigger(text, chat?.settings);
    if (trigger) {
      await makeLlmAnswer(ctx, trigger.provider, trigger.prompt);
      return;
    }

    const settings = chat?.settings;

    if (settings?.isChatterboxEnabled) {
      // Принудительный вызов: «балабол <фраза>» или своё слово из настроек
      const forced = matchChatterboxTrigger(
        text,
        settings.chatterboxTrigger?.trim() || CHATTERBOX_DEFAULT_TRIGGER,
      );
      if (forced) {
        await answerChatterbox(ctx, forced.prompt, chat, true);
        return;
      }

      // Реплай на сообщение бота — Балабол вступает в разговор (без молчаливых
      // сбоев); команды и «конвертер …» оставляем штатным обработчикам
      const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
      if (isReplyToBot && !text.startsWith('/') && !/^конвертер\s+/i.test(text)) {
        await answerChatterbox(ctx, text, chat, true);
        return;
      }
    }

    const recorded = await ctx.services.chat.recordChatterboxHistory(chatId, text, chat);

    if (recorded && recorded.isChatterboxEnabled) {
      const chance = recorded.chatterboxChance ?? 0.02;

      if (Math.random() < chance) {
        try {
          ctx.startTyping();

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

  bot.hears(/^конвертер\s+(.+)/i, async (ctx) => {
    const query = ctx.match[1];

    try {
      ctx.startTyping();

      const parsedData = await ctx.services.chat.parseCurrency(query, ctx.chat.id);

      if (!parsedData || !parsedData.amount || !parsedData.from) {
        return ctx.reply(
          'Не смог понять запрос. Напиши что-то вроде: "конвертер 100 долларов в евро"',
        );
      }

      const { amount, from, to } = parsedData;

      let message: string;
      try {
        const source = await ctx.services.conversion.resolveRatesSource(ctx.chat.id);
        const sellResult = ctx.services.currency.convert(amount, from, to, source);
        const buyResult =
          source === 'tbank'
            ? ctx.services.currency.convertPrice(amount, from, to, source)
            : sellResult;

        const line = (value: number, label?: string) => {
          const rounded = Number(value.toFixed(2));
          const suffix = label ? ` (${label})` : '';
          return `*${amount} ${from}* это примерно *${rounded} ${to}*${suffix}`;
        };

        if (buyResult !== sellResult) {
          const target = to === 'RUB' || from !== 'RUB' ? from : to;
          message = [
            line(sellResult, `продажа ${target}`),
            line(buyResult, `покупка ${target}`),
          ].join('\n');
        } else {
          message = line(sellResult);
        }
      } catch (convertError) {
        if (convertError instanceof Error) {
          logger.warn({ err: convertError }, 'Ошибка внутри CurrencyService');
          return ctx.reply(`Ошибка: ${convertError.message}`);
        } else {
          logger.warn({ err: convertError }, 'Неизвестная ошибка внутри CurrencyService');
          return ctx.reply('Произошла непредвиденная ошибка при конвертации.');
        }
      }

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_parameters: { message_id: ctx.msg.message_id },
      });
    } catch (error) {
      logger.error({ err: error }, 'Ошибка в команде конвертера');
      await ctx.reply('Произошла системная ошибка при конвертации');
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `💡 *Чем я могу помочь:*

💱 *Конвертация валют*
  — \`конвертер 100 usd\`, \`50 евро в тенге\`

💬 *AI-чат*
${buildAiChatHelp()}
  — \`балабол <фраза>\` — призвать Балабола; реплай на сообщение бота тоже работает
  — свои слова-триггеры: /app → Настройки

🎮 *Цены в Steam*
  — отправь ссылку: \`store.steampowered.com/app/…\`

🔍 *Inline-режим*
  — набери \`@botname <запрос>\` в любом чате
  — AI сам определит: валюта, вопрос, Steam

⏰ *Напоминания*
  — через Mini App: /app

💳 *Подписки*
  — через Mini App: /app
  — напомнит о списании за 1/3/7 дней
  — в уведомлении кнопки «Оплачено» и «Без напоминаний»

⚙️ *Настройки*
  — /app → API ключи провайдеров, системный промпт`,
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('start', async (ctx) => {
    const firstName = ctx.from?.first_name || 'пользователь';
    await ctx.reply(
      `Привет, ${firstName}! 👋

Я — многофункциональный бот. Умею конвертировать валюту, отвечать на вопросы, показывать цены в Steam, ставить напоминания, следить за подписками и многое другое.

Подробнее: /help

⚙️ Настроить API ключ и другое: /app`,
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('app', async (ctx) => {
    const chatId = ctx.chat.id;
    const isGroup = chatId < 0;

    if (isGroup) {
      const botUsername = ctx.me.username;

      const appShortName = config.APP_SHORTNAME;
      const appUrl = `https://t.me/${botUsername}/${appShortName}?startapp=${chatId}`;

      await ctx.reply('Приложение:', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Открыть приложение',
                url: appUrl,
              },
            ],
          ],
        },
      });
    } else {
      await ctx.reply('Приложение:', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Открыть приложение',
                web_app: { url: `${config.APP_URL}` },
              },
            ],
          ],
        },
      });
    }
  });
};

/** Ответ Балабола на принудительный вызов или реплай; текст вызова пишется в историю */
const answerChatterbox = async (
  ctx: BotContext,
  prompt: string,
  chat: ChatDocument | null,
  explain: boolean,
): Promise<void> => {
  if (!ctx.chat || !ctx.msg) return;

  const chatId = ctx.chat.id;

  try {
    if (prompt) {
      await ctx.services.chat.recordChatterboxHistory(chatId, prompt, chat);
    }

    ctx.startTyping();

    const reply = await ctx.services.chat.triggerChatterboxReply(chatId, prompt, { explain });

    if (reply) {
      await ctx.reply(reply, {
        reply_parameters: { message_id: ctx.msg.message_id },
      });
    }
  } catch (error) {
    logger.error({ err: error }, 'Ошибка chatterbox');
  }
};

const makeLlmAnswer = async (ctx: BotContext, provider: GPTProvider, prompt: string) => {
  if (!ctx.chat || !ctx.msg) return;

  const chatId = ctx.chat.id;
  const displayName = getProviderDef(provider).displayName;

  try {
    ctx.startTyping();

    const chatInfo = await ctx.services.chat.getChatInfo(chatId);
    const isPrivate = ctx.chat.type === 'private';
    const isStreaming = isPrivate && (chatInfo?.settings.isStreamingEnabled ?? false);

    if (isStreaming) {
      const stream = ctx.services.chat.processGptRequestStream(chatId, prompt, provider);
      await ctx.replyWithMarkdownStream(mapLatexStream(stream), undefined, {
        reply_parameters: { message_id: ctx.msg.message_id },
      });
    } else {
      const reply = await ctx.services.chat.processGptRequest(chatId, prompt, provider);
      const messages = splitMessage(convertLatexToRichMarkdown(reply));
      for (const msg of messages) {
        await ctx.replyWithRichMessage(
          { markdown: msg },
          { reply_parameters: { message_id: ctx.msg.message_id } },
        );
      }
    }
  } catch (error) {
    logger.error({ err: error }, `Критическая ошибка команды ${displayName}`);
    await ctx.reply(`Произошла ошибка при обращении к ${displayName}`);
  }
};

const buildAiChatHelp = (): string =>
  CHAT_TRIGGER_PROVIDERS.map((provider) => {
    const def = getProviderDef(provider);
    return `  — \`${def.keywords[0]} <вопрос>\` (${def.displayName})`;
  }).join('\n');
