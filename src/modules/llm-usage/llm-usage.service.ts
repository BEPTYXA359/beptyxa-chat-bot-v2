import { logger } from '../../shared/logger';
import { LlmUsageRepository } from './llm-usage.repository';
import { LlmTokenUsage, LlmUsageSource, LlmUsageSummary, LlmUsageTotals } from './llm-usage.types';

const DAYS_WINDOW = 30;

function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftUtcDay(date: Date, days: number): string {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toUtcDay(shifted);
}

const EMPTY_TOTALS: LlmUsageTotals = { requests: 0, promptTokens: 0, completionTokens: 0 };

export class LlmUsageService {
  constructor(private readonly repository: LlmUsageRepository) {}

  /** Ошибка записи не должна ломать пользовательский сценарий — только логируем. */
  public async record(chatId: number, usage: LlmTokenUsage, source: LlmUsageSource): Promise<void> {
    try {
      await this.repository.increment(chatId, usage, source, toUtcDay(new Date()));
    } catch (error) {
      logger.error(
        { err: error, chatId, source },
        'Не удалось записать статистику использования LLM',
      );
    }
  }

  public async getSummary(chatId: number): Promise<LlmUsageSummary> {
    const now = new Date();
    const today = toUtcDay(now);
    const monthStart = `${today.slice(0, 7)}-01`;
    const daysStart = shiftUtcDay(now, -(DAYS_WINDOW - 1));

    try {
      return await this.repository.aggregateSummary(chatId, today, monthStart, daysStart);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Ошибка агрегации статистики LLM');
      return {
        today: { ...EMPTY_TOTALS },
        month: { ...EMPTY_TOTALS },
        byModel: [],
        bySource: [],
        days: [],
      };
    }
  }
}
