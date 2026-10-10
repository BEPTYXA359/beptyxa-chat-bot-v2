import schedule from 'node-schedule';
import { logger } from '../../shared/logger';
import { RatesSource, RATES_SOURCE_LABELS, SourceRates, TbankRates } from './currency.types';
import { filterSteamCurrencies } from '../steam/steam-regions.const';
import {
  fetchCbrfRates,
  fetchOpenExchangeRates,
  fetchSteamMarketRates,
  fetchTbankRates,
} from './currency.providers';

export class CurrencyService {
  private ratesBySource = new Map<RatesSource, SourceRates>();
  private job: schedule.Job | null = null;
  private steamRetryTimer: NodeJS.Timeout | null = null;

  constructor() {}

  public async init(): Promise<void> {
    // OXR нужен сразу (дефолтный источник), остальные догружаем в фоне —
    // сбор цен с торговой площадки Steam занимает ~2 минуты из-за троттлинга
    await this.refreshSource('openexchangerates');
    void this.refreshSource('cbrf')
      .then(() => this.refreshSource('tbank'))
      .then(() => this.refreshSource('steam'));

    this.job = schedule.scheduleJob({ hour: 12, minute: 0, tz: 'Europe/Moscow' }, () => {
      void this.refreshAllSources();
    });

    logger.info('CurrencyService успешно инициализирован');
  }

  public destroy(): void {
    if (this.job) {
      this.job.cancel();
    }
    if (this.steamRetryTimer) {
      clearTimeout(this.steamRetryTimer);
      this.steamRetryTimer = null;
    }
  }

  private async refreshAllSources(): Promise<void> {
    await Promise.all([
      this.refreshSource('openexchangerates'),
      this.refreshSource('cbrf'),
      this.refreshSource('tbank'),
    ]);
    await this.refreshSource('steam');
  }

  /** Загружает (или обновляет) курсы одного источника; при ошибке остаются прежние курсы */
  public async refreshSource(source: RatesSource): Promise<void> {
    try {
      switch (source) {
        case 'openexchangerates':
          this.ratesBySource.set(source, await fetchOpenExchangeRates());
          break;
        case 'cbrf':
          this.ratesBySource.set(source, await fetchCbrfRates());
          break;
        case 'tbank':
          this.ratesBySource.set(source, await fetchTbankRates());
          break;
        case 'steam': {
          const steamRates = await this.loadSteamRatesWithFallback();
          if (!steamRates) {
            this.scheduleSteamRetry();
            throw new Error('Курсы Steam недоступны (маркет и фолбэк OXR)');
          }
          if (this.steamRetryTimer) {
            clearTimeout(this.steamRetryTimer);
            this.steamRetryTimer = null;
          }
          this.ratesBySource.set(source, steamRates);
          break;
        }
      }
      logger.info(`Курсы (${RATES_SOURCE_LABELS[source]}) успешно обновлены`);
    } catch (error) {
      // при ошибке оставляем предыдущие курсы, если они были
      logger.error({ err: error }, `Ошибка при обновлении курсов (${RATES_SOURCE_LABELS[source]})`);
    }
  }

  /**
   * Кошелёк Steam конвертирует по рыночному курсу. Маркет-предмет даёт эти курсы,
   * но при троттлинге Steam может отдавать мусор (бывали значения ×100) — поэтому
   * каждый курс сверяется с OXR (допуск 10%), а пропуски добираются из OXR.
   * В таблицу попадают только валюты наших Steam-регионов.
   * Если площадка недоступна совсем — берём рыночную таблицу OXR целиком.
   */
  private async loadSteamRatesWithFallback(): Promise<SourceRates | null> {
    let market: SourceRates | null = null;
    try {
      market = await fetchSteamMarketRates();
    } catch (error) {
      logger.warn({ err: error }, 'Не удалось собрать курсы Steam из торговой площадки');
    }

    let oxr = this.ratesBySource.get('openexchangerates');
    if (!oxr) {
      // санитизации нужна рыночная таблица — доставаем её на месте
      await this.refreshSource('openexchangerates');
      oxr = this.ratesBySource.get('openexchangerates');
    }
    if (!oxr) return null;
    if (!('rates' in oxr)) return null;
    if (!market) {
      logger.warn('Курсы Steam временно заменены рыночными из OpenExchangeRates');
      return { base: 'USD', rates: filterSteamCurrencies(oxr.rates) };
    }
    if (!('rates' in market)) {
      return market;
    }

    const rates: Record<string, number> = {};
    let dropped = 0;
    for (const [code, rate] of Object.entries(market.rates)) {
      const reference = oxr.rates[code];
      if (reference !== undefined && (rate < reference * 0.9 || rate > reference * 1.1)) {
        dropped++;
        continue;
      }
      rates[code] = rate;
    }
    if (dropped > 0) {
      logger.warn({ dropped }, 'Часть курсов Steam отброшена как некорректная');
    }

    // отсутствующие и забракованные валюты добираются рыночным курсом OXR
    return { base: 'USD', rates: filterSteamCurrencies({ ...oxr.rates, ...rates }) };
  }

  private scheduleSteamRetry(): void {
    if (this.steamRetryTimer) return; // повтор уже запланирован
    this.steamRetryTimer = setTimeout(
      () => {
        this.steamRetryTimer = null;
        void this.refreshSource('steam');
      },
      10 * 60 * 1000,
    );
    this.steamRetryTimer.unref?.();
  }

  /**
   * Обмен валюты по направлению клиента: отдаёт from, получает to.
   * Для Т-Банка учитывает спред: продажа X — по buy(X), покупка X — по sell(X).
   */
  public convert(
    amount: number,
    from: string,
    to: string,
    source: RatesSource = 'openexchangerates',
  ): number {
    return this.convertInternal(amount, from, to, source, false);
  }

  /**
   * Стоимость товара: цена в from, клиент платит to (обратная операция —
   * клиент покупает валюту цены). Для источников без спреда совпадает с convert.
   */
  public convertPrice(
    amount: number,
    from: string,
    to: string,
    source: RatesSource = 'openexchangerates',
  ): number {
    return this.convertInternal(amount, from, to, source, true);
  }

  private convertInternal(
    amount: number,
    from: string,
    to: string,
    source: RatesSource,
    isPrice: boolean,
  ): number {
    const rates = this.getSourceRates(source);
    if (!rates) {
      throw new Error('Курсы валют ещё не загружены');
    }

    const fromCode = from.toUpperCase();
    const toCode = to.toUpperCase();
    if (fromCode === toCode) return amount;

    if ('pairs' in rates) {
      if (fromCode !== 'RUB' && !rates.pairs[fromCode]) {
        throw new Error(`Т-Банк не котирует ${fromCode}`);
      }
      if (toCode !== 'RUB' && !rates.pairs[toCode]) {
        throw new Error(`Т-Банк не котирует ${toCode}`);
      }

      if (isPrice) {
        // цена в from, платим to: отдаём to, покупаем from
        if (fromCode === 'RUB') return amount / rates.pairs[toCode].buy;
        if (toCode === 'RUB') return amount * rates.pairs[fromCode].sell;
        return (amount * rates.pairs[fromCode].sell) / rates.pairs[toCode].buy;
      }

      // обмен: отдаём from, получаем to
      if (fromCode === 'RUB') return amount / rates.pairs[toCode].sell;
      if (toCode === 'RUB') return amount * rates.pairs[fromCode].buy;
      return (amount * rates.pairs[fromCode].buy) / rates.pairs[toCode].sell;
    }

    // базовая валюта таблицы может отсутствовать в rates — её курс равен 1
    const rateFrom = fromCode === rates.base ? 1 : rates.rates[fromCode];
    const rateTo = toCode === rates.base ? 1 : rates.rates[toCode];

    if (!rateFrom || !rateTo) {
      throw new Error(`Неизвестная валюта: ${fromCode} или ${toCode}`);
    }

    return (amount / rateFrom) * rateTo;
  }

  public getRates(source: RatesSource = 'openexchangerates'): SourceRates | null {
    return this.getSourceRates(source);
  }

  /**
   * Пары Т-Банка, дополненные композитными курсами для некотируемых валют
   * (так банк конвертирует через платёжную систему): нога USD — по курсу банка,
   * нога X — по ЦБ РФ. Если ЦБ ещё не загружен, возвращаются сырые пары.
   */
  private getEffectiveTbankRates(): TbankRates | null {
    const raw = this.ratesBySource.get('tbank');
    if (!raw || !('pairs' in raw)) return null;

    const usdPair = raw.pairs.USD;
    const cbrf = this.ratesBySource.get('cbrf');
    if (!usdPair || !cbrf || !('rates' in cbrf)) return raw;

    const pairs = { ...raw.pairs };
    for (const [code, ratePerUsd] of Object.entries(cbrf.rates)) {
      if (code === 'USD' || code === 'RUB' || pairs[code]) continue;
      pairs[code] = {
        buy: usdPair.buy / ratePerUsd,
        sell: usdPair.sell / ratePerUsd,
      };
    }
    return { base: 'RUB', pairs };
  }

  private getSourceRates(source: RatesSource): SourceRates | null {
    if (source === 'tbank') return this.getEffectiveTbankRates();
    return this.ratesBySource.get(source) ?? null;
  }
}
