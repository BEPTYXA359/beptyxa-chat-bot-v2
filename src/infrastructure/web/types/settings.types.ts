import { z } from 'zod';
import {
  MAX_SYSTEM_PROMPT_LENGTH,
  LlmProviderSettingsSchema,
} from '../../../modules/chat/chat.types';
import { LLM_PROVIDERS } from '../../../modules/llm-usage/llm-usage.types';

export const updateSettingsSchema = z.object({
  isOpenAiEnabled: z.boolean().optional(),
  isChatterboxEnabled: z.boolean().optional(),
  isStreamingEnabled: z.boolean().optional(),
  openAiApiKey: z.string().optional(),
  llmSystemPrompt: z
    .string()
    .max(MAX_SYSTEM_PROMPT_LENGTH, {
      message: `Слишком длинный системный промпт (максимум ${MAX_SYSTEM_PROMPT_LENGTH} символов)`,
    })
    .optional(),
  chatterboxSystemPrompt: z
    .string()
    .max(MAX_SYSTEM_PROMPT_LENGTH, {
      message: `Слишком длинный промпт балабола (максимум ${MAX_SYSTEM_PROMPT_LENGTH} символов)`,
    })
    .optional(),
  openAiModel: z.string().optional(),
  chatterboxChance: z.number().min(0).max(1).optional(),
  llmProviders: z.partialRecord(z.enum(LLM_PROVIDERS), LlmProviderSettingsSchema).optional(),
});

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;
