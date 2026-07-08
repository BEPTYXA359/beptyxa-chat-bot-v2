import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../../shared/logger';
import { config } from '../../shared/config';
import { telegramAuthHook } from './middlewares/telegram-auth.middleware';
import { ChatService } from '../../modules/chat/chat.service';
import { settingsRoutes } from './routes/settings.routes';
import { reminderRoutes } from './routes/reminder.routes';
import { ReminderService } from '../../modules/reminder/reminder.service';

export class WebServer {
  public readonly app: FastifyInstance;
  private readonly chatService: ChatService;
  private readonly reminderService: ReminderService;

  constructor(chatService: ChatService, reminderService: ReminderService) {
    this.chatService = chatService;
    this.reminderService = reminderService;
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

      protectedInstance.register(settingsRoutes, {
        prefix: '/api/settings',
        chatService: this.chatService,
      });

      protectedInstance.register(reminderRoutes, {
        prefix: '/api/reminders',
        reminderService: this.reminderService,
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
