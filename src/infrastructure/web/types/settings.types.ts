import { z } from 'zod';
import {
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_LLM_ALIAS_LENGTH,
  LlmProviderSettingsSchema,
} from '../../../modules/chat/chat.types';
import { LLM_PROVIDERS } from '../../../modules/llm-usage/llm-usage.types';

export const updateSettingsSchema = z.object({
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
      message: `Слишком длинный промпт Балабола (максимум ${MAX_SYSTEM_PROMPT_LENGTH} символов)`,
    })
    .optional(),
  openAiModel: z.string().optional(),
  chatterboxChance: z.number().min(0).max(1).optional(),
  chatterboxTrigger: z
    .string()
    .max(MAX_LLM_ALIAS_LENGTH, {
      message: `Слово-триггер Балабола — максимум ${MAX_LLM_ALIAS_LENGTH} символов`,
    })
    .refine((value) => value.trim().length === 0 || !/\s/.test(value.trim()), {
      message: 'Триггер Балабола должен быть одним словом',
    })
    .optional(),
  /** '' = явный сброс на дефолтного провайдера (Groq) */
  chatterboxProvider: z.union([z.enum(LLM_PROVIDERS), z.literal('')]).optional(),
  llmProviders: z.partialRecord(z.enum(LLM_PROVIDERS), LlmProviderSettingsSchema).optional(),
});

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;
