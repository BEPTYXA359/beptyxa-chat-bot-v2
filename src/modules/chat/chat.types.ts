import { z } from 'zod';
import { LLM_PROVIDERS } from '../llm-usage/llm-usage.types';

export const MAX_SYSTEM_PROMPT_LENGTH = 4000;
export const MAX_LLM_ALIAS_LENGTH = 30;

export const RoleSchema = z.enum(['system', 'user', 'assistant']);
export type Role = z.infer<typeof RoleSchema>;

export const ChatMessageSchema = z.object({
  role: RoleSchema,
  content: z.string(),
  timestamp: z.date(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const LlmProviderSettingsSchema = z.object({
  apiKey: z.string().max(512).optional(),
  model: z.string().max(128).optional(),
  alias: z.string().max(MAX_LLM_ALIAS_LENGTH).optional(),
});
export type LlmProviderSettings = z.infer<typeof LlmProviderSettingsSchema>;

export const ChatSettingsSchema = z.object({
  isOpenAiEnabled: z.boolean().default(true),
  isChatterboxEnabled: z.boolean().default(false),
  isStreamingEnabled: z.boolean().default(false),
  openAiApiKey: z.string().optional(),
  llmSystemPrompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).optional(),
  chatterboxSystemPrompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).optional(),
  openAiModel: z.string().default('gpt-4o-mini'),
  chatterboxChance: z.number().min(0).max(1).default(0.02),
  llmProviders: z.partialRecord(z.enum(LLM_PROVIDERS), LlmProviderSettingsSchema).optional(),
});
export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const ChatDocumentSchema = z.object({
  chatId: z.number(),
  settings: ChatSettingsSchema,
  gptMessages: z.array(ChatMessageSchema).default([]),
  chatterboxMessages: z.array(ChatMessageSchema).default([]),
});
export type ChatDocument = z.infer<typeof ChatDocumentSchema>;

export type GPTProvider = (typeof LLM_PROVIDERS)[number];
