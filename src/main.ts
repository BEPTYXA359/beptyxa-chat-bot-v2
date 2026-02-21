import { createBot } from './bot/bot';
import { logger } from './shared/logger';
import { CurrencyService } from './modules/converter/currency.service';
import { SteamService } from './modules/steam/steam.service';
import { setupSteamCommands } from './modules/steam/steam.command';

async function bootstrap() {
  try {
    logger.info('Инициализация приложения...');

    const currencyService = new CurrencyService();
    const steamService = new SteamService(currencyService);

    const bot = createBot();

    bot.use(async (ctx, next) => {
      ctx.services = {
        currency: currencyService,
        steam: steamService,
      };
      await next();
    });

    setupSteamCommands(bot);

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
