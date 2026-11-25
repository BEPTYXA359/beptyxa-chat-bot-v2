import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { run } from '@grammyjs/runner';

import { createBot } from './bot/bot';
import { logger } from './shared/logger';
import { Database } from './infrastructure/mongo/mongo.client';

import { CurrencyRepository } from './modules/currency/currency.repository';
import { CurrencyService } from './modules/currency/currency.service';
import { OpenAiProvider } from './infrastructure/llm/openai.provider';
import { GroqProvider } from './infrastructure/llm/groq.provider';
import { CryptoService } from './shared/services/crypto.service';

import { SteamService } from './modules/steam/steam.service';
import { setupSteamCommands } from './modules/steam/steam.command';

import { ChatRepository } from './modules/chat/chat.repository';
import { ChatService } from './modules/chat/chat.service';
import { setupChatCommands } from './modules/chat/chat.command';

import { QueryRouterService } from './modules/inline/query-router.service';
import { setupInlineCommands } from './modules/inline/inline.command';

import { WebServer } from './infrastructure/web/fastify.server';

import { ReminderRepository } from './modules/reminder/reminder.repository';
import { ReminderService } from './modules/reminder/reminder.service';

import { CarPlateRepository } from './modules/car-plate/car-plate.repository';
import { CarPlateService } from './modules/car-plate/car-plate.service';

import { SubscriptionRepository } from './modules/subscription/subscription.repository';
import { SubscriptionSettingsRepository } from './modules/subscription/subscription-settings.repository';
import { SubscriptionService } from './modules/subscription/subscription.service';
import { setupSubscriptionCallbacks } from './modules/subscription/subscription.command';

import { ConversionSettingsRepository } from './modules/conversion/conversion-settings.repository';
import { ConversionSettingsService } from './modules/conversion/conversion-settings.service';

import { LlmUsageRepository } from './modules/llm-usage/llm-usage.repository';
import { LlmUsageService } from './modules/llm-usage/llm-usage.service';

import { F1Repository } from './modules/f1/f1.repository';
import { F1SubscribersRepository } from './modules/f1/f1-subscribers.repository';
import { JolpicaProvider } from './modules/f1/jolpica.provider';
import { F1Service } from './modules/f1/f1.service';
import { F1Scheduler } from './modules/f1/f1.scheduler';

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

    const currencyRepository = new CurrencyRepository(db);
    await currencyRepository.ensureIndexes();
    const currencyService = new CurrencyService(currencyRepository);
    await currencyService.init();
    const cryptoService = new CryptoService();

    const openAiProvider = new OpenAiProvider();
    const groqProvider = new GroqProvider();

    const steamService = new SteamService(currencyService);

    const conversionSettingsRepository = new ConversionSettingsRepository(db);
    await conversionSettingsRepository.ensureIndexes();
    const conversionSettingsService = new ConversionSettingsService(conversionSettingsRepository);

    const llmUsageRepository = new LlmUsageRepository(db);
    await llmUsageRepository.ensureIndexes();
    const llmUsageService = new LlmUsageService(llmUsageRepository);

    const bot = createBot();
    const chatRepository = new ChatRepository(db);
    const chatService = new ChatService(
      chatRepository,
      openAiProvider,
      groqProvider,
      cryptoService,
      llmUsageService,
      bot,
    );

    const reminderRepository = new ReminderRepository(db);
    await reminderRepository.ensureIndexes();
    const reminderService = new ReminderService(
      reminderRepository,
      agenda,
      bot,
      steamService,
      conversionSettingsService,
    );

    const carPlateRepository = new CarPlateRepository(db);
    await carPlateRepository.ensureIndexes();
    const carPlateService = new CarPlateService(carPlateRepository);

    const subscriptionRepository = new SubscriptionRepository(db);
    const subscriptionSettingsRepository = new SubscriptionSettingsRepository(db);
    await subscriptionRepository.ensureIndexes();
    await subscriptionSettingsRepository.ensureIndexes();

    const subscriptionService = new SubscriptionService(
      subscriptionRepository,
      subscriptionSettingsRepository,
      agenda,
      bot,
      currencyService,
      conversionSettingsService,
    );

    const f1Repository = new F1Repository(db);
    const f1SubscribersRepository = new F1SubscribersRepository(db);
    await f1Repository.ensureIndexes();
    await f1SubscribersRepository.ensureIndexes();
    try {
      await f1Repository.deletePracticeResults();
    } catch (error) {
      logger.warn({ err: error }, 'Не удалось очистить кэш протоколов практик Ф1');
    }
    const f1Service = new F1Service(f1Repository, f1SubscribersRepository, new JolpicaProvider());
    const f1Scheduler = new F1Scheduler(
      agenda,
      f1Service,
      f1Repository,
      f1SubscribersRepository,
      bot,
    );

    await agenda.start();
    try {
      await f1Scheduler.init();
    } catch (error) {
      logger.error({ err: error }, 'Ошибка инициализации планировщика Ф1');
    }
    await reminderService.scheduleSteamCheckJob();
    await reminderService.reconcileJobs();
    await reminderService.catchUpMissed();
    await subscriptionService.scheduleSubscriptionCheckJob();
    await subscriptionService.repairSubscriptions();
    await subscriptionService.checkSubscriptions();

    bot.use(async (ctx, next) => {
      ctx.services = {
        currency: currencyService,
        steam: steamService,
        chat: chatService,
        conversion: conversionSettingsService,
      };
      await next();
    });

    setupSteamCommands(bot, reminderService);
    setupChatCommands(bot);
    setupSubscriptionCallbacks(bot, subscriptionService);

    const queryRouter = new QueryRouterService(groqProvider, llmUsageService);
    setupInlineCommands(bot, queryRouter);

    bot.catch((err) => {
      logger.error(
        { err: err.error },
        `Ошибка в работе бота для апдейта ${err.ctx.update.update_id}`,
      );
    });

    await bot.init();
    logger.info(`Бот @${bot.botInfo.username} успешно запущен!`);

    // Параллельная обработка апдейтов: долгие LLM-стримы и запросы к Steam
    // не задерживают апдейты других пользователей
    const runner = run(bot, { sink: { concurrency: 10 } });

    const webServer = new WebServer(
      chatService,
      reminderService,
      carPlateService,
      subscriptionService,
      currencyService,
      conversionSettingsService,
      llmUsageService,
      f1Service,
      f1Scheduler,
    );
    await webServer.init();
    await webServer.start();

    agenda.on('error', (error) => {
      logger.error({ err: error }, 'Внутренняя ошибка планировщика Agenda');
    });

    const stopApp = async () => {
      logger.info('Останавливаем бота...');
      await runner.stop();
      // stop() не ждёт уже запущенные апдейты — дожидаемся их сами, но не
      // дольше потолка, чтобы ручной Ctrl+C не вис на длинном LLM-стриме
      const drainDeadline = Date.now() + 30_000;
      while (runner.size() > 0 && Date.now() < drainDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await agenda.stop();
      await webServer.stop();
      await database.close();
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
