import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrencyService } from '../../../modules/currency/currency.service';
import { RATES_SOURCES } from '../../../modules/currency/currency.types';
import { ConversionSettingsService } from '../../../modules/conversion/conversion-settings.service';
import { logger } from '../../../shared/logger';

export interface CurrencyRoutesOptions {
  currencyService: CurrencyService;
  conversionSettingsService: ConversionSettingsService;
}

const sourceQuerySchema = z.object({
  source: z.enum(RATES_SOURCES).optional(),
  chatId: z.coerce.number().optional(),
});

/** Приоритет: явный ?source= → настройка чата по ?chatId= → дефолтный источник */
async function resolveSource(
  request: FastifyRequest,
  conversionSettingsService: ConversionSettingsService,
): Promise<(typeof RATES_SOURCES)[number]> {
  const query = sourceQuerySchema.safeParse(request.query);
  if (query.success && query.data.source) return query.data.source;

  const chatId = query.success && query.data.chatId ? query.data.chatId : request.user?.id;
  if (chatId) {
    return conversionSettingsService.resolveRatesSource(chatId);
  }
  return 'openexchangerates';
}

export const currencyRoutes: FastifyPluginAsync<CurrencyRoutesOptions> = async (
  fastify,
  options,
) => {
  const { currencyService, conversionSettingsService } = options;

  fastify.get('/', async (request, reply) => {
    let source: (typeof RATES_SOURCES)[number];
    try {
      source = await resolveSource(request, conversionSettingsService);
    } catch (error) {
      logger.error({ err: error }, 'Ошибка определения источника курсов');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }

    const rates = currencyService.getRates(source);
    if (!rates) {
      return reply.status(503).send({ error: 'Курсы валют ещё не загружены' });
    }
    return reply.send({ source, ...rates });
  });
};
