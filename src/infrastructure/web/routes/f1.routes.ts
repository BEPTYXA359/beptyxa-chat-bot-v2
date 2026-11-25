import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logger } from '../../../shared/logger';
import { F1NotFoundError, type F1Service } from '../../../modules/f1/f1.service';
import type { F1Scheduler } from '../../../modules/f1/f1.scheduler';
import { updateF1SettingsSchema } from '../../../modules/f1/f1.types';
import { getTargetChatId } from '../utils/request.util';

export interface F1RoutesOptions {
  f1Service: F1Service;
  f1Scheduler: F1Scheduler;
}

const roundParamsSchema = z.object({ round: z.coerce.number().int().positive() });

export const f1Routes: FastifyPluginAsync<F1RoutesOptions> = async (fastify, options) => {
  const { f1Service, f1Scheduler } = options;

  fastify.get('/overview', async (_request, reply) => {
    try {
      return reply.send(await f1Service.getOverview());
    } catch (error) {
      logger.error({ err: error }, 'Ошибка получения обзора Ф1');
      return reply.status(500).send({ error: 'Не удалось получить данные Ф1' });
    }
  });

  fastify.get('/gp/:round', async (request, reply) => {
    const params = roundParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Некорректный раунд' });
    try {
      return reply.send(await f1Service.getGrandPrix(params.data.round));
    } catch (error) {
      if (error instanceof F1NotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      logger.error({ err: error, round: params.data.round }, 'Ошибка получения протоколов ГП');
      return reply.status(500).send({ error: 'Не удалось получить протоколы ГП' });
    }
  });

  fastify.get('/settings/:chatId', async (request, reply) => {
    const chatId = getTargetChatId(request);
    try {
      return reply.send(await f1Service.getSettings(chatId));
    } catch (error) {
      logger.error({ err: error, chatId }, 'Ошибка получения настроек Ф1');
      return reply.status(500).send({ error: 'Не удалось получить настройки Ф1' });
    }
  });

  fastify.put('/settings/:chatId', async (request, reply) => {
    const chatId = getTargetChatId(request);
    const validation = updateF1SettingsSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validation.error),
      });
    }

    try {
      const settings = await f1Service.updateSettings(chatId, validation.data);
      try {
        await f1Scheduler.reconcile();
      } catch (error) {
        logger.error({ err: error, chatId }, 'Ошибка перепланирования задач Ф1');
      }
      return reply.send(settings);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Ошибка обновления настроек Ф1');
      return reply.status(500).send({ error: 'Не удалось обновить настройки Ф1' });
    }
  });
};
