import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createSubscriptionSchema,
  subscriptionSettingsSchema,
} from '../../../modules/subscription/subscription.types';
import {
  CurrencyRatesUnavailableError,
  InvalidSubscriptionCurrencyError,
  SubscriptionNotFoundError,
  SubscriptionService,
} from '../../../modules/subscription/subscription.service';
import { getTargetChatId } from '../utils/request.util';
import { logger } from '../../../shared/logger';

export interface SubscriptionRoutesOptions {
  subscriptionService: SubscriptionService;
}

/** Маппинг доменных ошибок в HTTP-коды; true если ошибка обработана */
function sendDomainError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof CurrencyRatesUnavailableError) {
    void reply.status(503).send({ error: error.message });
    return true;
  }
  if (error instanceof InvalidSubscriptionCurrencyError) {
    void reply.status(400).send({ error: error.message });
    return true;
  }
  if (error instanceof SubscriptionNotFoundError) {
    void reply.status(404).send({ error: error.message });
    return true;
  }
  return false;
}

export const subscriptionRoutes: FastifyPluginAsync<SubscriptionRoutesOptions> = async (
  fastify,
  options,
) => {
  const { subscriptionService } = options;

  fastify.get('/', async (request, reply) => {
    const targetChatId = getTargetChatId(request);

    try {
      const subscriptions = await subscriptionService.getSubscriptions(targetChatId);
      return reply.send(subscriptions);
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка получения подписок');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.get('/settings', async (request, reply) => {
    const targetChatId = getTargetChatId(request);

    try {
      const settings = await subscriptionService.getSettings(targetChatId);
      return reply.send(settings);
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка получения настроек подписок');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.put('/settings', async (request, reply) => {
    const targetChatId = getTargetChatId(request);

    const validationResult = subscriptionSettingsSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      const updated = await subscriptionService.updateSettings(
        targetChatId,
        validationResult.data.baseCurrency,
      );
      return reply.send({ baseCurrency: updated.baseCurrency });
    } catch (error) {
      if (sendDomainError(reply, error)) return reply;
      logger.error({ err: error, targetChatId }, 'Ошибка обновления настроек подписок');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.post('/', async (request, reply) => {
    const user = request.user!;
    const targetChatId = getTargetChatId(request);

    const validationResult = createSubscriptionSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      const subscription = await subscriptionService.createSubscription(
        targetChatId,
        user,
        validationResult.data,
      );
      return reply.send(subscription);
    } catch (error) {
      if (sendDomainError(reply, error)) return reply;
      logger.error({ err: error, targetChatId }, 'Ошибка сохранения подписки');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const targetChatId = getTargetChatId(request);

    const validationResult = createSubscriptionSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      await subscriptionService.updateSubscription(id, targetChatId, validationResult.data);
      return reply.send({ success: true, message: 'Подписка успешно обновлена' });
    } catch (error) {
      if (sendDomainError(reply, error)) return reply;
      logger.error({ err: error, id, targetChatId }, 'Ошибка редактирования подписки');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const targetChatId = getTargetChatId(request);

    try {
      await subscriptionService.deleteSubscription(id, targetChatId);
      return reply.send({ success: true, message: 'Подписка успешно удалена' });
    } catch (error) {
      if (sendDomainError(reply, error)) return reply;
      logger.error({ err: error, id, targetChatId }, 'Ошибка удаления подписки');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });
};
