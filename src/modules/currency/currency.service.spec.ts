import { describe, expect, it, vi, afterEach } from 'vitest';

// мок Т-Банка до импорта модулей: реальный запрос идёт через node:https (не fetch).
// KZT банком не котируется — в тестах композита она собирается из USD банка + ЦБ РФ
vi.mock('./tbank.http', () => ({
  fetchTbankJson: vi.fn(async () => ({
    payload: {
      rates: [
        {
          category: 'DebitCardsOperations',
          fromCurrency: { name: 'USD' },
          toCurrency: { name: 'RUB' },
          buy: 83.15,
          sell: 89.7,
        },
        // чужая категория — игнорируется
        {
          category: 'C2CTransfers',
          fromCurrency: { name: 'USD' },
          toCurrency: { name: 'RUB' },
          buy: 85,
          sell: 91,
        },
      ],
    },
  })),
}));

// импорт сервиса тянет logger → config, который требует NODE_ENV=development|production (vitest ставит test)
process.env.NODE_ENV = 'development';
const { CurrencyService } = await import('./currency.service');

type Service = InstanceType<typeof CurrencyService>;

const stubFetchUrl = (urlPart: string, payload: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url).includes(urlPart)) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${String(url)}`);
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CurrencyService.convert (табличные источники)', () => {
  it('кросс-курс через базу USD и дефолтный источник без параметра', async () => {
    stubFetchUrl('openexchangerates.org', {
      base: 'USD',
      rates: { RUB: 90, KZT: 0.2, EUR: 0.9 },
    });

    const service = new CurrencyService();
    await service.refreshSource('openexchangerates');

    expect(service.convert(900, 'RUB', 'KZT')).toBeCloseTo(2);
    expect(service.convert(900, 'RUB', 'KZT', 'openexchangerates')).toBeCloseTo(2);
    expect(service.convert(5, 'KZT', 'EUR')).toBeCloseTo((5 / 0.2) * 0.9);
    expect(service.convert(100, 'usd', 'RUB')).toBeCloseTo(9000);
    expect(service.getRates('openexchangerates')?.base).toBe('USD');
  });

  it('неизвестная валюта и незагруженные курсы дают понятные ошибки', async () => {
    stubFetchUrl('openexchangerates.org', { base: 'USD', rates: { RUB: 90 } });

    const service = new CurrencyService();
    expect(() => service.convert(1, 'USD', 'RUB')).toThrow('Курсы валют ещё не загружены');

    await service.refreshSource('openexchangerates');
    expect(() => service.convert(1, 'USD', 'GBP')).toThrow('Неизвестная валюта: USD или GBP');
  });
});

describe('CurrencyService.convert (ЦБ РФ, номиналы)', () => {
  it('приводит рублёвые котировки к базе USD с учётом Nominal', async () => {
    stubFetchUrl('cbr-xml-daily.ru', {
      Valute: {
        USD: { CharCode: 'USD', Nominal: 1, Value: 85.7116 },
        JPY: { CharCode: 'JPY', Nominal: 100, Value: 62.3 },
      },
    });

    const service = new CurrencyService();
    await service.refreshSource('cbrf');

    const rates = service.getRates('cbrf');
    expect(rates && 'rates' in rates && rates.rates.RUB).toBeCloseTo(85.7116);
    expect(rates && 'rates' in rates && rates.rates.JPY).toBeCloseTo(85.7116 / 0.623);

    // 100 JPY стоят 62.3 ₽ независимо от номинала
    expect(service.convert(100, 'JPY', 'RUB', 'cbrf')).toBeCloseTo(62.3);
    expect(service.convert(85.7116, 'RUB', 'USD', 'cbrf')).toBeCloseTo(1);
  });
});

describe('CurrencyService (направленные курсы Т-Банка + композит через ЦБ РФ)', () => {
  // ЦБ РФ: USD = 85 ₽, KZT = 17 ₽ за 100 → 500 KZT за 1 USD
  const loadTbank = async (): Promise<Service> => {
    stubFetchUrl('cbr-xml-daily.ru', {
      Valute: {
        USD: { CharCode: 'USD', Nominal: 1, Value: 85 },
        KZT: { CharCode: 'KZT', Nominal: 100, Value: 17 },
      },
    });
    const service = new CurrencyService();
    await service.refreshSource('cbrf');
    await service.refreshSource('tbank');
    return service;
  };

  // композитные пары KZT: buy = 83.15/500 = 0.1663, sell = 89.7/500 = 0.1794
  it('некотируемая валюта собирается из USD банка и ЦБ РФ', async () => {
    const service = await loadTbank();

    const rates = service.getRates('tbank');
    expect(rates && 'pairs' in rates && rates.pairs.KZT?.buy).toBeCloseTo(0.1663);
    expect(rates && 'pairs' in rates && rates.pairs.KZT?.sell).toBeCloseTo(0.1794);
    // котируемые пары остаются банковскими
    expect(rates && 'pairs' in rates && rates.pairs.USD).toEqual({ buy: 83.15, sell: 89.7 });
  });

  it('обмен: продажа валюты по buy, покупка по sell (в т.ч. композит)', async () => {
    const service = await loadTbank();

    // клиент отдаёт USD, получает рубли — банк покупает USD по 83.15
    expect(service.convert(100, 'USD', 'RUB', 'tbank')).toBeCloseTo(8315);
    // клиент отдаёт рубли, покупает USD — банк продаёт по 89.7
    expect(service.convert(897, 'RUB', 'USD', 'tbank')).toBeCloseTo(10);
    // KZT→RUB по композитному buy: 1000 × 83.15/500
    expect(service.convert(1000, 'KZT', 'RUB', 'tbank')).toBeCloseTo(1000 * (83.15 / 500));
    // кросс через рубль: продали KZT по buy, купили USD по sell
    expect(service.convert(10000, 'KZT', 'USD', 'tbank')).toBeCloseTo(
      (10000 * (83.15 / 500)) / 89.7,
    );
    // одна валюта — без конвертации
    expect(service.convert(123, 'USD', 'USD', 'tbank')).toBe(123);
  });

  it('convertPrice: стоимость товара — списание по sell, обратное направление по buy', async () => {
    const service = await loadTbank();

    // цена в USD, платим рублями: банк продаёт USD по 89.7
    expect(service.convertPrice(100, 'USD', 'RUB', 'tbank')).toBeCloseTo(8970);
    // цена в рублях, эквивалент в USD: чтобы набрать рубли, продаём USD по 83.15
    expect(service.convertPrice(8315, 'RUB', 'USD', 'tbank')).toBeCloseTo(100);
    // цена в KZT, платим рублями — композитный sell: 1000 × 89.7/500
    expect(service.convertPrice(1000, 'KZT', 'RUB', 'tbank')).toBeCloseTo(1000 * (89.7 / 500));
    // кросс: цена в KZT, платим USD — sell(KZT) / buy(USD)
    expect(service.convertPrice(10000, 'KZT', 'USD', 'tbank')).toBeCloseTo(
      (10000 * (89.7 / 500)) / 83.15,
    );
  });

  it('валюта, отсутствующая и у банка, и в ЦБ РФ, даёт ошибку с названием источника', async () => {
    const service = await loadTbank();

    expect(() => service.convert(1, 'XYZ', 'RUB', 'tbank')).toThrow('Т-Банк не котирует XYZ');
    expect(() => service.convertPrice(1, 'USD', 'XYZ', 'tbank')).toThrow('Т-Банк не котирует XYZ');
  });

  it('без загруженного ЦБ РФ некотируемая валюта тоже даёт ошибку', async () => {
    stubFetchUrl('never-matches', {});
    const service = new CurrencyService();
    await service.refreshSource('tbank');

    expect(() => service.convert(1, 'KZT', 'RUB', 'tbank')).toThrow('Т-Банк не котирует KZT');
  });
});
