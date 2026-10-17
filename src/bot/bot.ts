import { Bot, type Middleware } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { stream } from '@grammyjs/stream';
import { limit } from '@grammyjs/ratelimiter';
import { sequentialize } from '@grammyjs/runner';
import { BotContext } from './bot.types';
import { config } from '../shared/config';

/** Telegram сам гасит «печатает…» через ~5 с, поэтому повтор чуть раньше */
const TYPING_INTERVAL_MS = 4000;

const autoTyping = (): Middleware<BotContext> => async (ctx, next) => {
  const chatId = ctx.chat?.id;
  let timer: ReturnType<typeof setInterval> | undefined;

  const sendTyping = () => {
    if (chatId === undefined) return;
    ctx.api.sendChatAction(chatId, 'typing').catch(() => {
      clearInterval(timer);
      timer = undefined;
    });
  };

  ctx.startTyping = () => {
    if (timer) return;
    sendTyping();
    timer = setInterval(sendTyping, TYPING_INTERVAL_MS);
  };

  try {
    await next();
  } finally {
    clearInterval(timer);
  }
};

export const createBot = () => {
  const bot = new Bot<BotContext>(config.BOT_TOKEN);

  bot.api.config.use(autoRetry());
  bot.use(stream());

  // Флуд-гейт по пользователю: лимит общий для всех хендлеров, сами вызовы
  // LLM — самое дорогое, что может пойти по нему потоком
  bot.use(
    limit({
      limit: 20,
      timeFrame: 60_000,
      onLimitExceeded: async (ctx: BotContext) => {
        try {
          if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: 'Слишком часто, подожди немного' });
          } else if (ctx.chat) {
            await ctx.reply('Слишком часто, подожди немного 🙏');
          }
        } catch {
          // уведомление о лимите не критично
        }
      },
    }),
  );

  bot.use(
    sequentialize((ctx: BotContext) => {
      const keys: string[] = [];
      if (ctx.chat !== undefined) keys.push(`chat:${ctx.chat.id}`);
      if (ctx.from !== undefined) keys.push(`user:${ctx.from.id}`);
      return keys.length > 0 ? keys : undefined;
    }),
  );

  bot.use(autoTyping());

  return bot;
};
