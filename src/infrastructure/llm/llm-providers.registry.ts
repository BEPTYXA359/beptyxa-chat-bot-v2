import type { LlmUsageProvider } from '../../modules/llm-usage/llm-usage.types';

/**
 * Все провайдеры для AI-чата, кроме Groq, работают через OpenAI-совместимый API
 * (один SDK, отличается только baseUrl, набор моделей и список ключевых слов).
 */
export interface ChatLlmProviderDef {
  id: LlmUsageProvider;
  displayName: string;
  /** OpenAI-совместимый baseUrl; для OpenAi не задан (официальный эндпоинт) */
  baseUrl?: string;
  defaultModel: string;
  /** Слова-триггеры в начале сообщения; нижний регистр */
  keywords: string[];
  /** Фильтр текстовых моделей для списка в настройках */
  textModelRegex: RegExp;
  excludeKeywords: string[];
  /** Передавать ли stream_options.include_usage в стриме */
  supportsStreamOptions: boolean;
}

export const CHAT_LLM_PROVIDERS: ChatLlmProviderDef[] = [
  {
    id: 'OpenAi',
    displayName: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    keywords: ['чатгпт', 'гпт', 'chatgpt', 'gpt'],
    textModelRegex: /^(gpt-|o\d|chatgpt)/i,
    excludeKeywords: [
      'audio',
      'realtime',
      'tts',
      'dall-e',
      'whisper',
      'embedding',
      'image',
      'transcribe',
    ],
    supportsStreamOptions: true,
  },
  {
    id: 'Glm',
    displayName: 'GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-4.7',
    keywords: ['глм', 'glm'],
    textModelRegex: /^(glm-)/i,
    excludeKeywords: ['image', 'video', 'embedding', 'audio', 'cogview', 'cogvideo', 'vision'],
    supportsStreamOptions: false,
  },
  {
    id: 'DeepSeek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keywords: ['дипсик', 'дип', 'deepseek'],
    textModelRegex: /^(deepseek-)/i,
    excludeKeywords: ['embedding'],
    supportsStreamOptions: true,
  },
  {
    id: 'Gemini',
    displayName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    keywords: ['гемини', 'джемини', 'gemini'],
    textModelRegex: /^(gemini-)/i,
    excludeKeywords: [
      'image',
      'embedding',
      'audio',
      'tts',
      'veo',
      'imagen',
      'live',
      'native-audio',
    ],
    supportsStreamOptions: true,
  },
  {
    id: 'Anthropic',
    displayName: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    keywords: ['клод', 'клауд', 'claude'],
    textModelRegex: /^(claude-)/i,
    excludeKeywords: [],
    supportsStreamOptions: false,
  },
  {
    id: 'Xai',
    displayName: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    keywords: ['грокк', 'grok'],
    textModelRegex: /^(grok-)/i,
    excludeKeywords: ['image'],
    supportsStreamOptions: true,
  },
  {
    id: 'OpenRouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    keywords: ['опенроутер', 'openrouter'],
    textModelRegex: /.*/i,
    excludeKeywords: [],
    supportsStreamOptions: true,
  },
];

const groqDef: ChatLlmProviderDef = {
  id: 'Groq',
  displayName: 'Groq',
  defaultModel: 'groq',
  keywords: ['грок', 'groq'],
  textModelRegex: /.*/i,
  excludeKeywords: [],
  supportsStreamOptions: false,
};

const providerDefMap = new Map<LlmUsageProvider, ChatLlmProviderDef>(
  [groqDef, ...CHAT_LLM_PROVIDERS].map((def) => [def.id, def]),
);

export const getProviderDef = (id: LlmUsageProvider): ChatLlmProviderDef => {
  const def = providerDefMap.get(id);
  if (!def) {
    throw new Error(`Неизвестный LLM-провайдер: ${id}`);
  }
  return def;
};

/** Провайдеры, доступные в AI-чате по ключевому слову (Groq — по серверному ключу) */
export const CHAT_TRIGGER_PROVIDERS: LlmUsageProvider[] = [
  'Groq',
  ...CHAT_LLM_PROVIDERS.map((def) => def.id),
];
