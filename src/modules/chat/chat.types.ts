import { z } from 'zod';

export const RoleSchema = z.enum(['system', 'user', 'assistant']);
export type Role = z.infer<typeof RoleSchema>;

export const ChatMessageSchema = z.object({
  role: RoleSchema,
  content: z.string(),
  timestamp: z.date(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatSettingsSchema = z.object({
  isOpenAiEnabled: z.boolean().default(true),
  isChatterboxEnabled: z.boolean().default(false),
  openAiApiKey: z.string().optional(),
  openAiSystemPrompt: z.string().optional(),
  chatterboxSystemPrompt: z.string().optional(),
  openAiModel: z.string().default('gpt-4o-mini'),
  chatterboxChance: z.number().min(0).max(1).default(0.02),
});
export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const ChatDocumentSchema = z.object({
  chatId: z.number(),
  settings: ChatSettingsSchema,
  gptMessages: z.array(ChatMessageSchema).default([]),
  chatterboxMessages: z.array(ChatMessageSchema).default([]),
});
export type ChatDocument = z.infer<typeof ChatDocumentSchema>;
