import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { LlmUsageService } from './llm-usage.service';
import { LlmUsageRepository } from './llm-usage.repository';
import { LlmTokenUsage } from './llm-usage.types';

const usage: LlmTokenUsage = {
  provider: 'Groq',
  model: 'test-model',
  promptTokens: 10,
  completionTokens: 5,
};

function createRepoMock() {
  return {
    increment: vi.fn().mockResolvedValue(undefined),
    aggregateSummary: vi.fn().mockResolvedValue({
      today: { requests: 1, promptTokens: 10, completionTokens: 5 },
      month: { requests: 2, promptTokens: 20, completionTokens: 10 },
      byModel: [],
      bySource: [],
      days: [],
    }),
  };
}

function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('LlmUsageService.record', () => {
  it('пишет статистику с сегодняшним UTC-днём и источником', async () => {
    const repo = createRepoMock();
    const service = new LlmUsageService(repo as unknown as LlmUsageRepository);

    await service.record(42, usage, 'chat');

    expect(repo.increment).toHaveBeenCalledWith(42, usage, 'chat', toUtcDay(new Date()));
  });

  it('не бросает ошибку, если репозиторий упал', async () => {
    const repo = createRepoMock();
    repo.increment.mockRejectedValue(new Error('mongo down'));
    const service = new LlmUsageService(repo as unknown as LlmUsageRepository);

    await expect(service.record(42, usage, 'inline_chat')).resolves.toBeUndefined();
  });
});

describe('LlmUsageService.getSummary', () => {
  it('передаёт границы месяца и окно в 30 дней', async () => {
    const repo = createRepoMock();
    const service = new LlmUsageService(repo as unknown as LlmUsageRepository);

    await service.getSummary(42);

    const [chatId, today, monthStart, daysStart] = repo.aggregateSummary.mock.calls[0];

    expect(chatId).toBe(42);
    expect(today).toBe(toUtcDay(new Date()));
    expect(monthStart).toBe(`${today.slice(0, 7)}-01`);

    const expectedDaysStart = new Date();
    expectedDaysStart.setUTCDate(expectedDaysStart.getUTCDate() - 29);
    expect(daysStart).toBe(toUtcDay(expectedDaysStart));
  });

  it('возвращает нулевую сводку, если агрегация упала', async () => {
    const repo = createRepoMock();
    repo.aggregateSummary.mockRejectedValue(new Error('mongo down'));
    const service = new LlmUsageService(repo as unknown as LlmUsageRepository);

    const summary = await service.getSummary(42);

    expect(summary).toEqual({
      today: { requests: 0, promptTokens: 0, completionTokens: 0 },
      month: { requests: 0, promptTokens: 0, completionTokens: 0 },
      byModel: [],
      bySource: [],
      days: [],
    });
  });
});
