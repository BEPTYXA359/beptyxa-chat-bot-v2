import { z } from 'zod';

export const ExchangeRatesSchema = z.object({
  base: z.string(),
  rates: z.record(z.string(), z.number()),
});

export type OpenExchangeRatesResponse = z.infer<typeof ExchangeRatesSchema>;

export const currencyParseSchema = z.object({
  amount: z.coerce.number().positive(),
  from: z.string().min(2).max(5).toUpperCase(),
  to: z.string().min(2).max(5).toUpperCase().default('RUB'),
});

export type CurrencyParseResult = z.infer<typeof currencyParseSchema>;
