import { describe, expect, it, vi } from 'vitest';
import type { CurrencyService } from '../currency/currency.service';
import type { EditionInfo, SteamConversionOptions } from './steam.types';

// импорт сервиса тянет logger → config, который требует NODE_ENV=development|production (vitest ставит test)
process.env.NODE_ENV = 'development';
const { SteamService } = await import('./steam.service');

const createService = (
  convertPrice: CurrencyService['convertPrice'],
): InstanceType<typeof SteamService> =>
  new SteamService({ convertPrice } as unknown as CurrencyService);

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
          {
            bundleid: 234,
            purchase_option_name: 'Left 4 Dead 2 Deluxe Bundle',
            final_price_in_cents: '580000',
            included_game_count: 1,
          },
        ],
      },
    ],
  },
};

const getFetchMock = (payload: unknown): ReturnType<typeof vi.fn> =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

describe('getBundlesInfo', () => {
  it('достаёт только бандлы: цена из строки в валюте региона, скидка и число игр в имени', async () => {
    const fetchMock = getFetchMock(browseResponse);
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(vi.fn());

    const bundles = await service.getBundlesInfo('550');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bundles).toEqual([
      {
        name: 'Left 4 Dead Bundle (2 игры)',
        originalPrice: 5800,
        finalPrice: 4350,
        discountPercent: 25,
        isFree: false,
        currency: 'KZT',
      },
      {
        name: 'Valve Complete Pack (20 игр)',
        originalPrice: 35900,
        finalPrice: 32310,
        discountPercent: 10,
        isFree: false,
        currency: 'KZT',
      },
      {
        name: 'Left 4 Dead 2 Deluxe Bundle (1 игра)',
        originalPrice: null,
        finalPrice: 5800,
        discountPercent: null,
        isFree: false,
        currency: 'KZT',
      },
    ]);
    vi.unstubAllGlobals();
  });

  it('обрезает название игры только у бандла с одной игрой', async () => {
    vi.stubGlobal('fetch', getFetchMock(browseResponse));
    const service = createService(vi.fn());

    const bundles = await service.getBundlesInfo('550', 'Left 4 Dead 2');

    expect(bundles.map((bundle) => bundle.name)).toEqual([
      'Left 4 Dead Bundle (2 игры)',
      'Valve Complete Pack (20 игр)',
      'Deluxe Bundle (1 игра)',
    ]);
    vi.unstubAllGlobals();
  });

  it('кэширует результат по региону: тот же cc не делает новый запрос, другой cc делает', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(browseResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(vi.fn());

    await service.getBundlesInfo('550');
    await service.getBundlesInfo('550');
    await service.getBundlesInfo('550', undefined, 'ru');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('возвращает пустой список при ошибке запроса', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const service = createService(vi.fn());

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
    const service = createService(vi.fn());

    await expect(service.getBundlesInfo('550')).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('convertEditions', () => {
  const editions: EditionInfo[] = [
    {
      name: 'Базовая игра',
      originalPrice: null,
      finalPrice: 1000,
      discountPercent: null,
      isFree: false,
      currency: 'KZT',
    },
    {
      name: 'Free',
      originalPrice: null,
      finalPrice: 0,
      discountPercent: null,
      isFree: true,
      currency: 'KZT',
    },
  ];

  const options: SteamConversionOptions = {
    path: 'usd_bridge',
    targetCurrency: 'RUB',
    ratesSource: 'openexchangerates',
    extraPercent: 0,
  };

  it('path=converter: конвертирует по выбранному источнику конвертера', () => {
    const convertPrice = vi.fn().mockReturnValue(42);
    const service = createService(convertPrice as unknown as CurrencyService['convertPrice']);

    const converted = service.convertEditions(editions, { ...options, path: 'converter' });

    expect(convertPrice).toHaveBeenCalledTimes(1);
    expect(convertPrice).toHaveBeenCalledWith(1000, 'KZT', 'RUB', 'openexchangerates');
    expect(converted[0].convertedPrice).toBe(42);
    expect(converted[0].targetCurrency).toBe('RUB');
    expect(converted[1].convertedPrice).toBe(0);
  });

  it('path=steam: конвертирует по курсу Steam', () => {
    const convertPrice = vi.fn().mockReturnValue(7);
    const service = createService(convertPrice as unknown as CurrencyService['convertPrice']);

    const converted = service.convertEditions(editions, { ...options, path: 'steam' });

    expect(convertPrice).toHaveBeenCalledWith(1000, 'KZT', 'RUB', 'steam');
    expect(converted[0].convertedPrice).toBe(7);
  });

  it('path=usd_bridge: цена в долларах по Steam, затем покупка долларов по курсу конвертера', () => {
    const convertPrice = vi
      .fn()
      .mockReturnValueOnce(2) // KZT -> USD по Steam (паритет)
      .mockReturnValueOnce(100); // USD -> RUB по конвертеру (покупка $)
    const service = createService(convertPrice as unknown as CurrencyService['convertPrice']);

    const converted = service.convertEditions(editions, options);

    expect(convertPrice).toHaveBeenNthCalledWith(1, 1000, 'KZT', 'USD', 'steam');
    expect(convertPrice).toHaveBeenNthCalledWith(2, 2, 'USD', 'RUB', 'openexchangerates');
    expect(converted[0].convertedPrice).toBe(100);
  });

  it('ошибка конвертации даёт convertedPrice: null, форматтеры покажут только цену региона', () => {
    const convertPrice = vi.fn(() => {
      throw new Error('Курсы валют ещё не загружены');
    });
    const service = createService(convertPrice as unknown as CurrencyService['convertPrice']);

    const converted = service.convertEditions(editions, options);

    expect(converted[0].convertedPrice).toBeNull();
    expect(converted[0].finalPrice).toBe(1000);
    expect(converted[1].convertedPrice).toBe(0);
  });

  it('extraPercent увеличивает конвертированную цену, к бесплатным не применяется', () => {
    const convertPrice = vi.fn().mockReturnValue(100);
    const service = createService(convertPrice as unknown as CurrencyService['convertPrice']);

    const converted = service.convertEditions(editions, { ...options, extraPercent: 10 });

    expect(converted[0].convertedPrice).toBeCloseTo(110);
    expect(converted[0].extraPercent).toBe(10);
    expect(converted[1].convertedPrice).toBe(0);
  });

  it('процент указывается в подписи пути, а не в цене', () => {
    const service = createService(vi.fn() as unknown as CurrencyService['convertPrice']);

    expect(service.conversionNote({ ...options, extraPercent: 0 })).toBe(
      '_(цены: Steam → USD → OpenExchangeRates)_',
    );
    expect(service.conversionNote({ ...options, extraPercent: 2.5 })).toBe(
      '_(цены: Steam → USD → OpenExchangeRates + 2,5%)_',
    );
    expect(service.conversionNote({ ...options, path: 'converter', extraPercent: 10 })).toBe(
      '_(цены: по курсу OpenExchangeRates + 10%)_',
    );
  });

  it('совпадение валюты региона с целевой: convertedPrice = finalPrice без конвертации и процента', () => {
    const convertPrice = vi.fn();
    const service = createService(convertPrice as unknown as CurrencyService['convertPrice']);

    const rubEditions: EditionInfo[] = [
      {
        name: 'Стандарт',
        originalPrice: null,
        finalPrice: 999,
        discountPercent: null,
        isFree: false,
        currency: 'RUB',
      },
    ];
    const converted = service.convertEditions(rubEditions, { ...options, extraPercent: 10 });

    expect(convertPrice).not.toHaveBeenCalled();
    expect(converted[0].convertedPrice).toBe(999);
    // колонка конвертации не показывается
    expect(service.formatDlcTable(converted)).toContain('colspan="2"');
    expect(service.formatDlcTable(converted)).not.toContain('~');
  });
});
