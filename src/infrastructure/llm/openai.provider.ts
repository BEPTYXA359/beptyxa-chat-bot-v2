import OpenAI from 'openai';
import { logger } from '../../shared/logger';
import { ChatMessage } from '../../modules/chat/chat.types';
import { LlmTokenUsage } from '../../modules/llm-usage/llm-usage.types';
import type { LlmUsageProvider } from '../../modules/llm-usage/llm-usage.types';
import { CHAT_LLM_PROVIDERS, getProviderDef } from './llm-providers.registry';

export type LlmUsageCallback = (usage: LlmTokenUsage) => void;

/**
 * Параметры вызова OpenAI-совместимого провайдера (GLM, DeepSeek, Gemini, ... —
 * отличается только baseUrl и поддержка stream_options).
 */
export interface LlmCallOptions {
  provider: LlmUsageProvider;
  /** OpenAI-совместимый baseUrl; не задан для официального OpenAI */
  baseUrl?: string;
  /** Передавать stream_options.include_usage (не все провайдеры это поддерживают) */
  includeUsage?: boolean;
}

export class OpenAiProvider {
  public async generateText(
    messages: Omit<ChatMessage, 'timestamp'>[],
    apiKey: string,
    model: string,
    onUsage?: LlmUsageCallback,
    call: LlmCallOptions = { provider: 'OpenAi' },
  ): Promise<string> {
    try {
      const client = new OpenAI({ apiKey, baseURL: call.baseUrl });

      const response = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      if (onUsage) {
        onUsage({
          provider: call.provider,
          model,
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        });
      }

      return response.choices[0]?.message?.content || 'Извините, я не смог сгенерировать ответ.';
    } catch (error) {
      logger.error({ err: error, provider: call.provider }, 'Ошибка при запросе к LLM-провайдеру');
      throw new Error('Не удалось получить ответ от LLM-провайдера. Проверьте ваш API ключ.');
    }
  }

  public async *generateTextStream(
    messages: Omit<ChatMessage, 'timestamp'>[],
    apiKey: string,
    model: string,
    onUsage?: LlmUsageCallback,
    call: LlmCallOptions = { provider: 'OpenAi', includeUsage: true },
  ): AsyncIterable<string> {
    const client = new OpenAI({ apiKey, baseURL: call.baseUrl });

    const stream = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      ...(call.includeUsage ? { stream_options: { include_usage: true as const } } : {}),
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;

      // Провайдер не прислал usage — запись не создаём, чтобы не засорять статистику нулями
      if (onUsage && chunk.usage) {
        onUsage({
          provider: call.provider,
          model,
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        });
      }
    }
  }

  public async getAvailableTextModels(
    apiKey: string,
    call: LlmCallOptions = { provider: 'OpenAi' },
  ): Promise<Array<string>> {
    const def = CHAT_LLM_PROVIDERS.find((entry) => entry.id === call.provider);
    const textModelRegex = def?.textModelRegex ?? getProviderDef('OpenAi').textModelRegex;
    const excludeKeywords = def?.excludeKeywords ?? [];

    try {
      const client = new OpenAI({ apiKey, baseURL: call.baseUrl });
      const response = await client.models.list();

      return response.data
        .filter((model) => {
          const lowerId = model.id.toLowerCase();
          const isTextPattern = textModelRegex.test(lowerId);
          const hasExcludedKeyword = excludeKeywords.some((keyword) => lowerId.includes(keyword));
          return isTextPattern && !hasExcludedKeyword;
        })
        .map((model) => model.id)
        .sort();
    } catch (error) {
      logger.error(
        { err: error, provider: call.provider },
        'Ошибка при запросе списка моделей к LLM-провайдеру',
      );
      return [];
    }
  }
}
