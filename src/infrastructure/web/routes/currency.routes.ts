import { FastifyPluginAsync } from 'fastify';
import { CurrencyService } from '../../../modules/currency/currency.service';

export interface CurrencyRoutesOptions {
  currencyService: CurrencyService;
}

export const currencyRoutes: FastifyPluginAsync<CurrencyRoutesOptions> = async (
  fastify,
  options,
) => {
  const { currencyService } = options;

  fastify.get('/', async (_request, reply) => {
    const rates = currencyService.getRates();
    if (!rates) {
      return reply.status(503).send({ error: 'Курсы валют ещё не загружены' });
    }
    return reply.send(rates);
  });
};
