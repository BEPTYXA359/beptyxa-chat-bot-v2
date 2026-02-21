import schedule from 'node-schedule';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';
import { ExchangeRatesSchema } from './currency.types';

export class CurrencyService {
  private baseCurrency: string = 'USD';
  private rates: Record<string, number> = {};

  constructor() {
    this.init();
  }

  private async fetchRates() {
    try {
      const response = await fetch(
        `https://openexchangerates.org/api/latest.json?app_id=${config.EXCHANGE_APP_ID}`,
      );
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const rawData = await response.json();
      const parsedData = ExchangeRatesSchema.parse(rawData);

      this.baseCurrency = parsedData.base;
      this.rates = parsedData.rates;
      logger.info('Курсы валют успешно обновлены');
    } catch (error) {
      logger.error({ err: error }, 'Ошибка при обновлении курсов');
    }
  }

  private init() {
    this.fetchRates();

    schedule.scheduleJob({ hour: 12, minute: 0, tz: 'Europe/Moscow' }, () => {
      this.fetchRates();
    });
  }

  public convert(amount: number, from: string, to: string): number {
    if (Object.keys(this.rates).length === 0) {
      throw new Error('Курсы валют еще не загружены');
    }

    const rateFrom = this.rates[from];
    const rateTo = this.rates[to];

    if (!rateFrom || !rateTo) {
      throw new Error(`Неизвестная валюта: ${from} или ${to}`);
    }

    return (amount / rateFrom) * rateTo;
  }
}
