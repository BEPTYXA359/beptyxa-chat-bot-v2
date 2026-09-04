import { z } from 'zod';

export const LlmUsageSourceSchema = z.enum([
  'chat',
  'chatterbox',
  'inline_chat',
  'inline_router',
  'currency_parse',
]);
export type LlmUsageSource = z.infer<typeof LlmUsageSourceSchema>;

export const LLM_PROVIDERS = ['OpenAi', 'Groq'] as const;
export type LlmUsageProvider = (typeof LLM_PROVIDERS)[number];

export interface LlmTokenUsage {
  provider: LlmUsageProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export const LlmUsageDocumentSchema = z.object({
  chatId: z.number(),
  provider: z.enum(LLM_PROVIDERS),
  model: z.string(),
  source: LlmUsageSourceSchema,
  day: z.string(),
  requests: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
});
export type LlmUsageDocument = z.infer<typeof LlmUsageDocumentSchema>;

export interface LlmUsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmUsageModelBreakdown extends LlmUsageTotals {
  provider: LlmUsageProvider;
  model: string;
}

export interface LlmUsageSourceBreakdown extends LlmUsageTotals {
  source: LlmUsageSource;
  provider: LlmUsageProvider;
}

export interface LlmUsageDayBreakdown extends LlmUsageTotals {
  day: string;
}

export interface LlmUsageSummary {
  today: LlmUsageTotals;
  month: LlmUsageTotals;
  byModel: LlmUsageModelBreakdown[];
  bySource: LlmUsageSourceBreakdown[];
  days: LlmUsageDayBreakdown[];
}
