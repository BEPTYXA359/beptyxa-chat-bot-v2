import { Bot } from 'grammy';
import { BotContext } from './bot.types';
import { config } from '../shared/config';
import { logger } from '../shared/logger';

export const createBot = () => {
    const bot = new Bot<BotContext>(config.BOT_TOKEN);

    bot.catch((err) => {
        const ctx = err.ctx;
        const e = err.error;
        logger.error(
            { err: e, update_id: ctx.update.update_id },
            'Ошибка при обработке update'
        );
    });

    bot.command('start', async (ctx) => {
        logger.info({ user_id: ctx.from?.id }, 'Пользователь запустил бота');
        await ctx.reply('Привет! Я работаю на новой архитектуре. 🚀');
    });

    return bot;
};