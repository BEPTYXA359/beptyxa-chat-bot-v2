import type { ChatSettings, GPTProvider } from './chat.types';
import {
  CHAT_TRIGGER_PROVIDERS,
  getProviderDef,
} from '../../infrastructure/llm/llm-providers.registry';

export interface LlmTrigger {
  provider: GPTProvider;
  prompt: string;
}

/**
 * Слова-триггеры провайдера: свой алиас из настроек заменяет стандартные
 * ключевые слова, иначе используются слова из реестра.
 */
export const getProviderTriggers = (provider: GPTProvider, settings?: ChatSettings): string[] => {
  const customAlias = settings?.llmProviders?.[provider]?.alias?.trim().toLowerCase();
  if (customAlias) return [customAlias];
  return getProviderDef(provider).keywords;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Определяет, начинается ли сообщение со слова-триггера одного из провайдеров
 * («чатгпт вопрос», «глм вопрос», своё слово из настроек).
 * Триггер должен быть отдельным словом; при пересечении слов побеждает более длинное.
 */
export const detectLlmTrigger = (text: string, settings?: ChatSettings): LlmTrigger | null => {
  const trimmed = text.trim();

  const matchers = CHAT_TRIGGER_PROVIDERS.flatMap((provider) =>
    getProviderTriggers(provider, settings).map((word) => ({ provider, word })),
  ).sort((a, b) => b.word.length - a.word.length);

  for (const { provider, word } of matchers) {
    if (!word) continue;

    const match = new RegExp(`^${escapeRegExp(word)}\\s+(.+)$`, 'i').exec(trimmed);
    if (!match) continue;

    const prompt = match[1].trim();
    if (!prompt) continue;

    return { provider, prompt };
  }

  return null;
};
