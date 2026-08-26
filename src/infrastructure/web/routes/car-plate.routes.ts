import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createCarPlateSchema } from '../../../modules/car-plate/car-plate.types';
import { CarPlateService, DuplicatePlateError } from '../../../modules/car-plate/car-plate.service';
import { getTargetChatId } from '../utils/request.util';
import { logger } from '../../../shared/logger';

export interface CarPlateRoutesOptions {
  carPlateService: CarPlateService;
}

export const carPlateRoutes: FastifyPluginAsync<CarPlateRoutesOptions> = async (
  fastify,
  options,
) => {
  const { carPlateService } = options;

  fastify.get('/', async (request, reply) => {
    const targetChatId = getTargetChatId(request);

    try {
      const plates = await carPlateService.getPlates(targetChatId);
      return reply.send(plates);
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка получения номеров');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.post('/', async (request, reply) => {
    const user = request.user!;
    const targetChatId = getTargetChatId(request);

    const validationResult = createCarPlateSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      await carPlateService.createPlate(targetChatId, user, validationResult.data);
      return reply.send({ success: true, message: 'Номер успешно сохранён' });
    } catch (error) {
      if (error instanceof DuplicatePlateError) {
        return reply.status(409).send({ error: error.message });
      }
      logger.error({ err: error, targetChatId }, 'Ошибка сохранения номера');
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Внутренняя ошибка сервера' });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const targetChatId = getTargetChatId(request);

    const validationResult = createCarPlateSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      await carPlateService.updatePlate(id, targetChatId, validationResult.data);
      return reply.send({ success: true, message: 'Номер успешно обновлён' });
    } catch (error) {
      if (error instanceof DuplicatePlateError) {
        return reply.status(409).send({ error: error.message });
      }
      logger.error({ err: error, id }, 'Ошибка редактирования номера');
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Внутренняя ошибка сервера' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await carPlateService.deletePlate(id);
      return reply.send({ success: true, message: 'Номер успешно удалён' });
    } catch (error) {
      logger.error({ err: error, id }, 'Ошибка удаления номера');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });
};
