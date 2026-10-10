import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { updateConversionSettingsSchema } from '../../../modules/conversion/conversion.types';
import { ConversionSettingsService } from '../../../modules/conversion/conversion-settings.service';
import { getTargetChatId } from '../utils/request.util';
import { logger } from '../../../shared/logger';

export interface ConversionSettingsRoutesOptions {
  conversionSettingsService: ConversionSettingsService;
}

export const conversionSettingsRoutes: FastifyPluginAsync<ConversionSettingsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { conversionSettingsService } = options;

  fastify.get('/', async (request, reply) => {
    const targetChatId = getTargetChatId(request);

    try {
      const settings = await conversionSettingsService.getSettings(targetChatId);
      return reply.send(settings);
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка получения настроек конвертации');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.put('/', async (request, reply) => {
    const targetChatId = getTargetChatId(request);

    const validationResult = updateConversionSettingsSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      const settings = await conversionSettingsService.update(targetChatId, validationResult.data);
      return reply.send(settings);
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка обновления настроек конвертации');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });
};
