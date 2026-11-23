import { afterEach, describe, expect, it, vi } from 'vitest';

// импорт провайдеров тянет logger → config, который требует NODE_ENV=development|production (vitest ставит test)
process.env.NODE_ENV = 'development';
const { parseMarketPrice } = await import('./currency.providers');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

describe('fetchSteamMarketRates при троттлинге Steam', () => {
  it('при устойчивом 429 обрывает проход после ретрая и кидает SteamRateLimitError', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response('too many requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchSteamMarketRates } = await import('./currency.providers');

    vi.useFakeTimers();
    let settled = false;
    const outcome = fetchSteamMarketRates()
      .finally(() => {
        settled = true;
      })
      .then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );
    for (let i = 0; i < 300 && !settled; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }
    vi.useRealTimers();

    const error = (await outcome) as Error;
    expect(error.name).toBe('SteamRateLimitError');
    // 429 + один ретрай — дальше долбить маркет бессмысленно, Steam должен отдохнуть
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchSteamMarketRates в дев-режиме', () => {
  it('опрашивает только USD, RUB и KZT и принимает таблицу из трёх валют', async () => {
    vi.resetModules();
    const pricesByCurrencyId: Record<string, string> = {
      '1': '$32.78',
      '5': '2 949 ₽',
      '37': '14 773 ₸',
    };
    const fetchMock = vi.fn(async (url: string | URL) => {
      const currencyId = new URL(String(url)).searchParams.get('currency') ?? '';
      return new Response(
        JSON.stringify({ success: true, lowest_price: pricesByCurrencyId[currencyId] }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchSteamMarketRates } = await import('./currency.providers');

    vi.useFakeTimers();
    let settled = false;
    const outcome = fetchSteamMarketRates()
      .finally(() => {
        settled = true;
      })
      .then(
        (rates) => rates,
        (error: unknown) => error,
      );
    for (let i = 0; i < 100 && !settled; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }
    vi.useRealTimers();

    const rates = (await outcome) as { base: string; rates: Record<string, number> };
    expect(rates.base).toBe('USD');
    expect(Object.keys(rates.rates).sort()).toEqual(['KZT', 'RUB', 'USD']);
    expect(rates.rates.USD).toBeCloseTo(1);
    expect(rates.rates.RUB).toBeCloseTo(2949 / 32.78, 4);
    expect(rates.rates.KZT).toBeCloseTo(14773 / 32.78, 4);
    // 3 валюты × 2 предмета; остальные 33 валюты в дев-режиме не запрашиваются
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
