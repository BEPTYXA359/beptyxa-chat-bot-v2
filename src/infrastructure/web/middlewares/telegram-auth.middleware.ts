import { FastifyRequest, FastifyReply } from 'fastify';
import { validateTelegramData } from '../../../shared/utils/telegram.util';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/logger';
import { TelegramUser, telegramUserSchema } from '../../../shared/types/telegram.types';
import { z } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TelegramUser;
  }
}

export const telegramAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Отклонен запрос без правильного заголовка Authorization');
    return reply.status(401).send({ error: 'Unauthorized: Отсутствует токен доступа' });
  }

  const initData = authHeader.split(' ')[1];

  const isValid = validateTelegramData(initData, config.BOT_TOKEN);

  if (!isValid) {
    logger.warn('Отклонен запрос с невалидной подписью Telegram');
    return reply.status(403).send({ error: 'Forbidden: Недействительная подпись данных' });
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');

    if (!userStr) {
      return reply.status(400).send({ error: 'Bad Request: Отсутствует поле user в initData' });
    }

    const rawUser = JSON.parse(userStr);
    const validationResult = telegramUserSchema.safeParse(rawUser);

    if (!validationResult.success) {
      logger.warn(
        { error: z.treeifyError(validationResult.error) },
        'Невалидные данные пользователя от Telegram',
      );
      return reply
        .status(400)
        .send({ error: 'Bad Request: Некорректный формат данных пользователя' });
    }
    request.user = validationResult.data;
  } catch (error) {
    logger.error({ err: error }, 'Критическая ошибка при парсинге initData');
    return reply.status(400).send({ error: 'Bad Request: Ошибка обработки данных' });
  }
};
