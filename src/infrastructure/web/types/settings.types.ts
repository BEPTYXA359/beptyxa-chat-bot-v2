import { z } from 'zod';

export const updateSettingsSchema = z.object({
  isOpenAiEnabled: z.boolean().optional(),
  isChatterboxEnabled: z.boolean().optional(),
  openAiApiKey: z.string().optional(),
  llmSystemPrompt: z.string().optional(),
  chatterboxSystemPrompt: z.string().optional(),
  openAiModel: z.string().optional(),
  chatterboxChance: z.number().min(0).max(1).optional(),
});

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;
