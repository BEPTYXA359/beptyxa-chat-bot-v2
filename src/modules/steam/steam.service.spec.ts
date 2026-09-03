import { describe, expect, it, vi } from 'vitest';
import type { CurrencyService } from '../currency/currency.service';

// импорт сервиса тянет logger → config, который требует NODE_ENV=development|production (vitest ставит test)
process.env.NODE_ENV = 'development';
const { SteamService } = await import('./steam.service');

const createService = (convert: CurrencyService['convert']): InstanceType<typeof SteamService> =>
  new SteamService({ convert } as unknown as CurrencyService);

const browseResponse = {
  response: {
    store_items: [
      {
        success: 1,
        purchase_options: [
          {
            packageid: 2481,
            purchase_option_name: 'Left 4 Dead 2',
            final_price_in_cents: '290000',
          },
          {
            bundleid: 233,
            purchase_option_name: 'Left 4 Dead Bundle',
            final_price_in_cents: '435000',
            bundle_discount_pct: 25,
            price_before_bundle_discount: '580000',
            included_game_count: 2,
          },
          {
            bundleid: 232,
            purchase_option_name: 'Valve Complete Pack',
            final_price_in_cents: '3231000',
            bundle_discount_pct: 10,
            price_before_bundle_discount: '3590000',
            included_game_count: 20,
          },
        ],
      },
    ],
  },
};

const getFetchMock = (payload: unknown): ReturnType<typeof vi.fn> =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

describe('getBundlesInfo', () => {
  it('достаёт только бандлы: цена из строки в KZT, скидка, RUB и число игр в имени', async () => {
    const fetchMock = getFetchMock(browseResponse);
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(() => 30);

    const bundles = await service.getBundlesInfo('550');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bundles).toEqual([
      {
        name: 'Left 4 Dead Bundle (2 игры)',
        originalPriceKzt: 5800,
        finalPriceKzt: 4350,
        discountPercent: 25,
        finalPriceRub: 30,
        isFree: false,
      },
      {
        name: 'Valve Complete Pack (20 игр)',
        originalPriceKzt: 35900,
        finalPriceKzt: 32310,
        discountPercent: 10,
        finalPriceRub: 30,
        isFree: false,
      },
    ]);
    vi.unstubAllGlobals();
  });

  it('обрезает название игры из имени бандла, если передано gameName', async () => {
    vi.stubGlobal('fetch', getFetchMock(browseResponse));
    const service = createService(() => 30);

    const bundles = await service.getBundlesInfo('550', 'Left 4 Dead 2');

    expect(bundles.map((bundle) => bundle.name)).toEqual([
      'Bundle (2 игры)',
      'Valve Complete Pack (20 игр)',
    ]);
    vi.unstubAllGlobals();
  });

  it('кэширует результат: повторный вызов не делает новый запрос', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(browseResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(() => 30);

    await service.getBundlesInfo('550');
    await service.getBundlesInfo('550');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('возвращает пустой список при ошибке запроса', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const service = createService(() => 30);

    await expect(service.getBundlesInfo('550')).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });

  it('возвращает пустой список, если элемент магазина не успешен', async () => {
    const failedResponse = {
      response: { store_items: [{ item_type: -1, id: 4294967295, success: 8 }] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(failedResponse), { status: 200 })),
    );
    const service = createService(() => 30);

    await expect(service.getBundlesInfo('550')).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});
