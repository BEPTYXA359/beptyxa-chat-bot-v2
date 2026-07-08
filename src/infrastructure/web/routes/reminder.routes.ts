import { FastifyPluginAsync } from 'fastify';
import { createReminderSchema } from '../../../modules/reminder/reminder.types';
import { ReminderService } from '../../../modules/reminder/reminder.service';
import { getTargetChatId } from '../utils/request.util';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

export interface ReminderRoutesOptions {
  reminderService: ReminderService;
}

export const reminderRoutes: FastifyPluginAsync<ReminderRoutesOptions> = async (
  fastify,
  options,
) => {
  const { reminderService } = options;

  fastify.get('/', async (request, reply) => {
    const targetChatId = getTargetChatId(request);

    try {
      const reminders = await reminderService.getActiveReminders(targetChatId);
      return reply.send(reminders);
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка получения напоминаний');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.post('/', async (request, reply) => {
    const user = request.user!;
    const targetChatId = getTargetChatId(request);

    const validationResult = createReminderSchema.safeParse(request.body);

    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      await reminderService.createReminder(targetChatId, user, validationResult.data);
      return reply.send({ success: true, message: 'Напоминание успешно создано' });
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка создания напоминания');
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Внутренняя ошибка сервера' });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const targetChatId = getTargetChatId(request);

    const validationResult = createReminderSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({ error: 'Неверный формат данных' });
    }

    try {
      await reminderService.updateReminder(id, targetChatId, validationResult.data);
      return reply.send({ success: true, message: 'Напоминание успешно обновлено' });
    } catch (error) {
      logger.error({ err: error, id }, 'Ошибка редактирования напоминания');
      return reply.status(500).send({ error: 'Не удалось обновить напоминание' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await reminderService.deleteReminder(id);
      return reply.send({ success: true, message: 'Напоминание успешно удалено' });
    } catch (error) {
      logger.error({ err: error, id }, 'Ошибка удаления напоминания');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });
};
