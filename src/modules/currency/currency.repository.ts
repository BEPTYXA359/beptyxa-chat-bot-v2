import type { Collection, Db } from 'mongodb';
import type { RatesSource, SourceRates } from './currency.types';

interface CurrencyRatesDocument {
  source: RatesSource;
  rates: SourceRates;
  updatedAt: Date;
}

/** Хранит последние успешные курсы каждого источника для фолбэка после рестарта */
export class CurrencyRepository {
  private readonly rates: Collection<CurrencyRatesDocument>;

  constructor(db: Db) {
    this.rates = db.collection<CurrencyRatesDocument>('currencyRates');
  }

  async ensureIndexes(): Promise<void> {
    await this.rates.createIndex({ source: 1 }, { unique: true });
  }

  async getEntry(source: RatesSource): Promise<{ rates: SourceRates; updatedAt: Date } | null> {
    const document = await this.rates.findOne({ source });
    if (!document) return null;
    return { rates: document.rates, updatedAt: document.updatedAt };
  }

  async getRates(source: RatesSource): Promise<SourceRates | null> {
    return (await this.getEntry(source))?.rates ?? null;
  }

  async saveRates(source: RatesSource, rates: SourceRates): Promise<void> {
    await this.rates.updateOne(
      { source },
      { $set: { rates, updatedAt: new Date() } },
      { upsert: true },
    );
  }
}
