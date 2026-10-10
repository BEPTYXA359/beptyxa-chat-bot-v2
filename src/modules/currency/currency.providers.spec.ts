import { describe, expect, it } from 'vitest';

// импорт провайдеров тянет logger → config, который требует NODE_ENV=development|production (vitest ставит test)
process.env.NODE_ENV = 'development';
const { parseMarketPrice } = await import('./currency.providers');

describe('parseMarketPrice', () => {
  it.each([
    ['$32.78', 32.78],
    ['29,30€', 29.3],
    ['14 773₸', 14773],
    ['2793 руб.', 2793],
    ['₡15.085', 15085],
    ['₡14.951,28', 14951.28],
    ['$U1.317', 1317],
    ['10.02 KD', 10.02],
    ['0,03€', 0.03],
    ['119.56 QR', 119.56],
  ])('разбирает «%s» как %d', (raw, expected) => {
    expect(parseMarketPrice(raw)).toBeCloseTo(expected, 6);
  });
});
