import { Bot } from 'grammy';
import { InlineQueryResultArticle } from 'grammy/types';
import { BotContext } from '../../bot/bot.types';
import { logger } from '../../shared/logger';
import { QueryRouterService } from './query-router.service';
import { RouterResult } from './inline.types';

const MIN_QUERY_LENGTH = 3;

const recentQueries = new Map<number, { query: string; ts: number }>();
const TTL_MS = 2500;

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of recentQueries) {
    if (now - val.ts > TTL_MS * 2) recentQueries.delete(key);
  }
}, 60000);

function isRedundant(userId: number, query: string): boolean {
  const prev = recentQueries.get(userId);
  const now = Date.now();

  if (!prev || now - prev.ts > TTL_MS) {
    recentQueries.set(userId, { query, ts: now });
    return false;
  }

  const lenDiff = Math.abs(query.length - prev.query.length);

  const isMinorEdit =
    (query.startsWith(prev.query) || prev.query.startsWith(query)) && lenDiff <= 2;

  if (isMinorEdit) return true;

  recentQueries.set(userId, { query, ts: now });
  return false;
}

function helpArticle(): InlineQueryResultArticle {
  return {
    type: 'article',
    id: 'help_1',
    title: '💡 Я умею:',
    description: '💱 конвертировать валюту · 💬 отвечать на вопросы · 🎮 искать цены Steam',
    input_message_content: {
      message_text: `💡 Я могу помочь в любом чате!

💱 *Конвертация валют*
  — \`100 usd\`, \`50 евро в тенге\`, \`конвертер 150 рублей\`

💬 *Ответы на вопросы*
  — просто задай любой вопрос

🎮 *Цены в Steam*
  — отправь ссылку на игру: \`store.steampowered.com/app/…\``,
      parse_mode: 'Markdown',
    },
  };
}

function currencyArticle(
  amount: number,
  from: string,
  to: string,
  result: number,
): InlineQueryResultArticle {
  const roundedResult = Number(result.toFixed(2));
  const title = `💱 ${amount} ${from} = ${roundedResult} ${to}`;

  return {
    type: 'article',
    id: `currency_${Date.now()}`,
    title,
    description: 'Конвертация валют',
    input_message_content: {
      message_text: `*${amount} ${from}* это примерно *${roundedResult} ${to}*`,
      parse_mode: 'Markdown',
    },
  };
}

function currencyErrorArticle(): InlineQueryResultArticle {
  return {
    type: 'article',
    id: `currency_err_${Date.now()}`,
    title: '❌ Не смог распознать валюту',
    description: 'Пример: 100 usd в rub, 50 евро в тенге',
    input_message_content: {
      message_text:
        'Не смог распознать валюту. Напишите что-то вроде:\n\n`100 usd в eur`\n`50 евро в тенге`',
      parse_mode: 'Markdown',
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function aiArticle(query: string, response: string): InlineQueryResultArticle {
  const message = `<blockquote>${escapeHtml(query)}</blockquote>\n\n${escapeHtml(response)}`;
  const title = response.length > 60 ? response.slice(0, 60) + '…' : response;

  return {
    type: 'article',
    id: `ai_${Date.now()}`,
    title,
    description: query.length > 80 ? query.slice(0, 80) + '…' : query,
    input_message_content: {
      message_text: message,
      parse_mode: 'HTML',
    },
  };
}

function aiErrorArticle(): InlineQueryResultArticle {
  return {
    type: 'article',
    id: `ai_err_${Date.now()}`,
    title: '❌ Не удалось получить ответ',
    description: 'Попробуйте переформулировать вопрос',
    input_message_content: {
      message_text: 'Извините, не удалось получить ответ. Попробуйте позже.',
    },
  };
}

function steamArticle(
  gameName: string,
  formattedMessage: string,
  appId: string,
): InlineQueryResultArticle {
  const lines = formattedMessage.split('\n').filter((l) => l.trim());
  const firstPriceLine = lines.find((l) => l.includes('₸') || l.includes('₽')) || '';

  return {
    type: 'article',
    id: `steam_${appId}`,
    title: `${gameName}`,
    description: firstPriceLine.trim(),
    input_message_content: {
      message_text: formattedMessage,
      parse_mode: 'Markdown',
    },
  };
}

function steamErrorArticle(): InlineQueryResultArticle {
  return {
    type: 'article',
    id: `steam_err_${Date.now()}`,
    title: '❌ Игра не найдена',
    description: 'Проверьте ссылку или попробуйте другую игру',
    input_message_content: {
      message_text:
        'Не удалось получить информацию об игре. API Steam временно недоступен или игра не найдена.',
    },
  };
}

export const setupInlineCommands = (bot: Bot<BotContext>, router: QueryRouterService): void => {
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const { services } = ctx;
    const userId = ctx.from.id;

    if (query.length < MIN_QUERY_LENGTH) {
      await ctx.answerInlineQuery([helpArticle()], { cache_time: 0 });
      return;
    }

    try {
      const routerResult = await router.route(query);

      if (routerResult.intent === 'ai_chat' && isRedundant(userId, query)) {
        await ctx.answerInlineQuery([helpArticle()], { cache_time: 0 });
        return;
      }

      let articles: InlineQueryResultArticle[];

      switch (routerResult.intent) {
        case 'currency_convert':
          articles = await handleCurrency(query, routerResult, services);
          break;
        case 'steam_info':
          articles = routerResult.steamAppId
            ? await handleSteam(routerResult.steamAppId, services)
            : [helpArticle()];
          break;
        case 'ai_chat':
          articles = await handleAiChat(query, services);
          break;
        default:
          articles = [helpArticle()];
      }

      await ctx.answerInlineQuery(articles, {
        cache_time: 0,
        is_personal: routerResult.intent === 'ai_chat',
      });
    } catch (error) {
      logger.error({ err: error, query }, 'inline: необработанная ошибка');
      await ctx.answerInlineQuery([helpArticle()], { cache_time: 0 });
    }
  });
};

async function handleCurrency(
  query: string,
  routerResult: RouterResult,
  services: BotContext['services'],
): Promise<InlineQueryResultArticle[]> {
  try {
    let amount: number;
    let from: string;
    let to: string;

    if (routerResult.amount && routerResult.from) {
      amount = routerResult.amount;
      from = routerResult.from;
      to = routerResult.to || 'RUB';
    } else {
      const parsed = await services.chat.parseCurrency(query);
      if (!parsed || !parsed.amount || !parsed.from) {
        return [currencyErrorArticle()];
      }
      amount = parsed.amount;
      from = parsed.from;
      to = parsed.to;
    }

    const result = services.currency.convert(amount, from, to);
    return [currencyArticle(amount, from, to, result)];
  } catch (error) {
    logger.warn({ err: error, query }, 'inline: ошибка конвертации');
    return [currencyErrorArticle()];
  }
}

async function handleAiChat(
  query: string,
  services: BotContext['services'],
): Promise<InlineQueryResultArticle[]> {
  try {
    const response = await services.chat.processGptRequestSimple(query);
    return [aiArticle(query, response)];
  } catch (error) {
    logger.error({ err: error, query }, 'inline: ошибка AI чата');
    return [aiErrorArticle()];
  }
}

async function handleSteam(
  appId: string,
  services: BotContext['services'],
): Promise<InlineQueryResultArticle[]> {
  try {
    const gameInfo = await services.steam.getGameInfo(appId);
    const msg = services.steam.formatGameInline(
      gameInfo.editions,
      gameInfo.subscriptions,
      gameInfo.gameName,
      gameInfo.hasRussianLanguage,
      gameInfo.releaseDate,
      gameInfo.isComingSoon,
      gameInfo.isGameFree,
    );

    return [steamArticle(gameInfo.gameName, msg, appId)];
  } catch (error) {
    logger.warn({ err: error, appId }, 'inline: ошибка Steam');
    return [steamErrorArticle()];
  }
}
