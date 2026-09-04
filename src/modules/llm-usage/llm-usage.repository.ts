import { Collection, Db, MongoServerError } from 'mongodb';
import {
  LlmTokenUsage,
  LlmUsageDayBreakdown,
  LlmUsageDocument,
  LlmUsageModelBreakdown,
  LlmUsageSource,
  LlmUsageSourceBreakdown,
  LlmUsageTotals,
} from './llm-usage.types';

interface FacetGroupResult {
  _id: null | string | { provider: string; model: string } | { source: string; provider: string };
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

interface FacetResult {
  today: FacetGroupResult[];
  month: FacetGroupResult[];
  byModel: FacetGroupResult[];
  bySource: FacetGroupResult[];
  days: FacetGroupResult[];
}

export class LlmUsageRepository {
  private readonly collection: Collection<LlmUsageDocument>;

  constructor(db: Db) {
    this.collection = db.collection<LlmUsageDocument>('llmUsage');
  }

  public async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { chatId: 1, provider: 1, model: 1, source: 1, day: 1 },
      { unique: true },
    );
  }

  public async increment(
    chatId: number,
    usage: LlmTokenUsage,
    source: LlmUsageSource,
    day: string,
  ): Promise<void> {
    const filter = { chatId, provider: usage.provider, model: usage.model, source, day };
    const update = {
      $inc: {
        requests: 1,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      },
    };

    try {
      await this.collection.updateOne(filter, update, { upsert: true });
    } catch (error) {
      // Гонка двух одновременных upsert: документ уже создал другой запрос — повторяем
      if (error instanceof MongoServerError && error.code === 11000) {
        await this.collection.updateOne(filter, update, { upsert: true });
        return;
      }
      throw error;
    }
  }

  public async aggregateSummary(
    chatId: number,
    today: string,
    monthStart: string,
    daysStart: string,
  ): Promise<{
    today: LlmUsageTotals;
    month: LlmUsageTotals;
    byModel: LlmUsageModelBreakdown[];
    bySource: LlmUsageSourceBreakdown[];
    days: LlmUsageDayBreakdown[];
  }> {
    const sumFields = {
      requests: { $sum: '$requests' },
      promptTokens: { $sum: '$promptTokens' },
      completionTokens: { $sum: '$completionTokens' },
    };

    const [result] = await this.collection
      .aggregate<FacetResult>([
        { $match: { chatId } },
        {
          $facet: {
            today: [{ $match: { day: today } }, { $group: { _id: null, ...sumFields } }],
            month: [
              { $match: { day: { $gte: monthStart, $lte: today } } },
              { $group: { _id: null, ...sumFields } },
            ],
            byModel: [
              { $match: { day: { $gte: monthStart, $lte: today } } },
              { $group: { _id: { provider: '$provider', model: '$model' }, ...sumFields } },
              { $sort: { requests: -1 } },
            ],
            bySource: [
              { $match: { day: { $gte: monthStart, $lte: today } } },
              { $group: { _id: { source: '$source', provider: '$provider' }, ...sumFields } },
              { $sort: { requests: -1 } },
            ],
            days: [
              { $match: { day: { $gte: daysStart, $lte: today } } },
              { $group: { _id: '$day', ...sumFields } },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ])
      .toArray();

    const toTotals = (groups: FacetGroupResult[]): LlmUsageTotals => {
      const group = groups[0];
      return group
        ? {
            requests: group.requests,
            promptTokens: group.promptTokens,
            completionTokens: group.completionTokens,
          }
        : { requests: 0, promptTokens: 0, completionTokens: 0 };
    };

    return {
      today: toTotals(result?.today ?? []),
      month: toTotals(result?.month ?? []),
      byModel: (result?.byModel ?? []).map((row) => {
        const key = row._id as { provider: string; model: string };
        return {
          provider: key.provider as LlmUsageModelBreakdown['provider'],
          model: key.model,
          requests: row.requests,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
        };
      }),
      bySource: (result?.bySource ?? []).map((row) => {
        const key = row._id as { source: string; provider: string };
        return {
          source: key.source as LlmUsageSourceBreakdown['source'],
          provider: key.provider as LlmUsageSourceBreakdown['provider'],
          requests: row.requests,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
        };
      }),
      days: (result?.days ?? []).map((row) => ({
        day: row._id as string,
        requests: row.requests,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
      })),
    };
  }
}
