import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../../shared/logger';
import { config } from '../../shared/config';
import { telegramAuthHook } from './middlewares/telegram-auth.middleware';
import { ChatService } from '../../modules/chat/chat.service';
import { settingsRoutes } from './routes/settings.routes';

export class WebServer {
  public readonly app: FastifyInstance;
  private readonly chatService: ChatService;

  constructor(chatService: ChatService) {
    this.chatService = chatService;
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

    this.app.get('/api/ping', async (request, reply) => {
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
