import { createBot } from './bot/bot';
import { logger } from './shared/logger';
import { Database } from './infrastructure/mongo/mongo.client';

import { CurrencyService } from './modules/converter/currency.service';
import { OpenAiProvider } from './infrastructure/llm/openai.provider';
import { GroqProvider } from './infrastructure/llm/groq.provider';
import { CryptoService } from './shared/services/crypto.service';

import { SteamService } from './modules/steam/steam.service';
import { setupSteamCommands } from './modules/steam/steam.command';

import { ChatRepository } from './modules/chat/chat.repository';
import { ChatService } from './modules/chat/chat.service';
import { setupChatCommands } from './modules/chat/chat.command';

async function bootstrap() {
  try {
    logger.info('Инициализация приложения...');

    const database = await Database.getInstance();
    const db = database.getDb();

    const currencyService = new CurrencyService();
    const cryptoService = new CryptoService();

    const openAiProvider = new OpenAiProvider();
    const groqProvider = new GroqProvider();

    const steamService = new SteamService(currencyService);

    const chatRepository = new ChatRepository(db);

    const chatService = new ChatService(
      chatRepository,
      openAiProvider,
      groqProvider,
      cryptoService,
    );

    const bot = createBot();

    bot.use(async (ctx, next) => {
      ctx.services = {
        currency: currencyService,
        steam: steamService,
        chat: chatService,
      };
      await next();
    });

    setupSteamCommands(bot);
    setupChatCommands(bot);

    bot.catch((err) => {
      logger.error(
        { err: err.error },
        `Ошибка в работе бота для апдейта ${err.ctx.update.update_id}`,
      );
    });

    bot.start({
      onStart: (botInfo) => {
        logger.info(`Бот @${botInfo.username} успешно запущен!`);
      },
    });

    const stopApp = () => {
      logger.info('Останавливаем бота...');
      bot.stop();
      process.exit(0);
    };

    process.once('SIGINT', stopApp);
    process.once('SIGTERM', stopApp);
  } catch (error) {
    logger.fatal({ err: error }, 'Критическая ошибка при запуске приложения');
    process.exit(1);
  }
}

bootstrap();
