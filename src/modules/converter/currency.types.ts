import { z } from 'zod';

export const ExchangeRatesSchema = z.object({
  base: z.string(),
  rates: z.record(z.string(), z.number()),
});

export type OpenExchangeRatesResponse = z.infer<typeof ExchangeRatesSchema>;
