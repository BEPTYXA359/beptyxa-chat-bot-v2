import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';

import { createBot } from './bot/bot';
import { logger } from './shared/logger';
import { Database } from './infrastructure/mongo/mongo.client';

import { CurrencyService } from './modules/currency/currency.service';
import { OpenAiProvider } from './infrastructure/llm/openai.provider';
import { GroqProvider } from './infrastructure/llm/groq.provider';
import { CryptoService } from './shared/services/crypto.service';

import { SteamService } from './modules/steam/steam.service';
import { setupSteamCommands } from './modules/steam/steam.command';

import { ChatRepository } from './modules/chat/chat.repository';
import { ChatService } from './modules/chat/chat.service';
import { setupChatCommands } from './modules/chat/chat.command';
import { WebServer } from './infrastructure/web/fastify.server';

import { ReminderRepository } from './modules/reminder/reminder.repository';
import { ReminderService } from './modules/reminder/reminder.service';

async function bootstrap() {
  try {
    logger.info('Инициализация приложения...');

    const database = await Database.getInstance();
    const db = database.getDb();

    const agenda = new Agenda({
      backend: new MongoBackend({
        mongo: db,
        collection: 'agendaJobs',
      }),
    });

    const currencyService = new CurrencyService();
    await currencyService.init();
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

    const reminderRepository = new ReminderRepository(db);
    const reminderService = new ReminderService(reminderRepository, agenda, bot);

    await agenda.start();
    await reminderService.syncJobs();

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

    const webServer = new WebServer(chatService, reminderService);
    await webServer.init();
    await webServer.start();

    agenda.on('error', (error) => {
      logger.error({ err: error }, 'Внутренняя ошибка планировщика Agenda');
    });

    const stopApp = async () => {
      logger.info('Останавливаем бота...');
      await agenda.stop();
      await database.close();
      await bot.stop();
      await webServer.stop();
      currencyService.destroy();

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
