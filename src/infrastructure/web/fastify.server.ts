import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../../shared/logger';
import { config } from '../../shared/config';
import { telegramAuthHook } from './middlewares/telegram-auth.middleware';
import { createChatAuthorizationHook } from './middlewares/chat-authorization.middleware';
import { ChatService } from '../../modules/chat/chat.service';
import { settingsRoutes } from './routes/settings.routes';
import { reminderRoutes } from './routes/reminder.routes';
import { ReminderService } from '../../modules/reminder/reminder.service';
import { carPlateRoutes } from './routes/car-plate.routes';
import { CarPlateService } from '../../modules/car-plate/car-plate.service';
import { subscriptionRoutes } from './routes/subscription.routes';
import { SubscriptionService } from '../../modules/subscription/subscription.service';
import { currencyRoutes } from './routes/currency.routes';
import { CurrencyService } from '../../modules/currency/currency.service';
import { conversionSettingsRoutes } from './routes/conversion-settings.routes';
import { ConversionSettingsService } from '../../modules/conversion/conversion-settings.service';
import { llmUsageRoutes } from './routes/llm-usage.routes';
import { LlmUsageService } from '../../modules/llm-usage/llm-usage.service';
import { F1Service } from '../../modules/f1/f1.service';
import { F1Scheduler } from '../../modules/f1/f1.scheduler';
import { f1Routes } from './routes/f1.routes';

export class WebServer {
  public readonly app: FastifyInstance;
  private readonly chatService: ChatService;
  private readonly reminderService: ReminderService;
  private readonly carPlateService: CarPlateService;
  private readonly subscriptionService: SubscriptionService;
  private readonly currencyService: CurrencyService;
  private readonly conversionSettingsService: ConversionSettingsService;
  private readonly llmUsageService: LlmUsageService;
  private readonly f1Service: F1Service;
  private readonly f1Scheduler: F1Scheduler;

  constructor(
    chatService: ChatService,
    reminderService: ReminderService,
    carPlateService: CarPlateService,
    subscriptionService: SubscriptionService,
    currencyService: CurrencyService,
    conversionSettingsService: ConversionSettingsService,
    llmUsageService: LlmUsageService,
    f1Service: F1Service,
    f1Scheduler: F1Scheduler,
  ) {
    this.chatService = chatService;
    this.reminderService = reminderService;
    this.carPlateService = carPlateService;
    this.subscriptionService = subscriptionService;
    this.currencyService = currencyService;
    this.conversionSettingsService = conversionSettingsService;
    this.llmUsageService = llmUsageService;
    this.f1Service = f1Service;
    this.f1Scheduler = f1Scheduler;
    this.app = Fastify({
      logger: true,
      trustProxy: true,
    });
  }

  public async init(): Promise<void> {
    await this.app.register(cors, {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    });

    this.app.get('/api/ping', async () => {
      return {
        status: 'ok',
        message: 'Fastify server is running!',
        time: new Date().toISOString(),
      };
    });

    this.app.register(async (protectedInstance) => {
      protectedInstance.addHook('preValidation', telegramAuthHook);
      protectedInstance.addHook('preHandler', createChatAuthorizationHook(this.chatService));

      protectedInstance.register(settingsRoutes, {
        prefix: '/api/settings',
        chatService: this.chatService,
      });

      protectedInstance.register(reminderRoutes, {
        prefix: '/api/reminders',
        reminderService: this.reminderService,
      });

      protectedInstance.register(carPlateRoutes, {
        prefix: '/api/car-plates',
        carPlateService: this.carPlateService,
      });

      protectedInstance.register(subscriptionRoutes, {
        prefix: '/api/subscriptions',
        subscriptionService: this.subscriptionService,
      });

      protectedInstance.register(currencyRoutes, {
        prefix: '/api/currency',
        currencyService: this.currencyService,
        conversionSettingsService: this.conversionSettingsService,
      });

      protectedInstance.register(conversionSettingsRoutes, {
        prefix: '/api/conversion-settings',
        conversionSettingsService: this.conversionSettingsService,
      });

      protectedInstance.register(llmUsageRoutes, {
        prefix: '/api/llm-usage',
        llmUsageService: this.llmUsageService,
        chatService: this.chatService,
      });

      protectedInstance.register(f1Routes, {
        prefix: '/api/f1',
        f1Service: this.f1Service,
        f1Scheduler: this.f1Scheduler,
      });
    });
  }

  public async start(): Promise<void> {
    try {
      const port = Number(config.PORT) || 3000;
      await this.app.listen({ port, host: '0.0.0.0' });
      logger.info(`Web сервер успешно запущен на порту ${port}`);
    } catch (err) {
      logger.error({ err }, 'Ошибка при запуске Fastify сервера');
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    await this.app.close();
    logger.info('Web сервер остановлен');
  }
}
