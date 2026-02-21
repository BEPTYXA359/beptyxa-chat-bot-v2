import { createBot } from './bot/bot';
import { logger } from './shared/logger';

async function bootstrap() {
  try {
    logger.info('Инициализация приложения...');

    const bot = createBot();

    bot.start({
      onStart: (botInfo) => {
        logger.info(`Бот @${botInfo.username} успешно запущен!`);
      },
    });

    // Graceful shutdown (правильное завершение работы)
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
