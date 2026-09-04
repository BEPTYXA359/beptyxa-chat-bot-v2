import OpenAI from 'openai';
import { logger } from '../../shared/logger';
import { ChatMessage } from '../../modules/chat/chat.types';
import { LlmTokenUsage } from '../../modules/llm-usage/llm-usage.types';

export type LlmUsageCallback = (usage: LlmTokenUsage) => void;

export class OpenAiProvider {
  public async generateText(
    messages: Omit<ChatMessage, 'timestamp'>[],
    apiKey: string,
    model: string,
    onUsage?: LlmUsageCallback,
  ): Promise<string> {
    try {
      const client = new OpenAI({ apiKey });

      const response = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      if (onUsage) {
        onUsage({
          provider: 'OpenAi',
          model,
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        });
      }

      return response.choices[0]?.message?.content || 'Извините, я не смог сгенерировать ответ.';
    } catch (error) {
      logger.error({ err: error }, 'Ошибка при запросе к OpenAI API');
      throw new Error('Не удалось получить ответ от OpenAI. Проверьте ваш API ключ.');
    }
  }

  public async *generateTextStream(
    messages: Omit<ChatMessage, 'timestamp'>[],
    apiKey: string,
    model: string,
    onUsage?: LlmUsageCallback,
  ): AsyncIterable<string> {
    const client = new OpenAI({ apiKey });

    const stream = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
    });

    let reported = false;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;

      if (onUsage && chunk.usage) {
        onUsage({
          provider: 'OpenAi',
          model,
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        });
        reported = true;
      }
    }

    if (onUsage && !reported) {
      onUsage({ provider: 'OpenAi', model, promptTokens: 0, completionTokens: 0 });
    }
  }

  public async getAvailableTextModels(apiKey: string): Promise<Array<string>> {
    try {
      const client = new OpenAI({ apiKey });
      const response = await client.models.list();

      const textModelRegex = /^(gpt-)/i;
      const excludeKeywords = [
        'audio',
        'realtime',
        'tts',
        'dall-e',
        'whisper',
        'embedding',
        'image',
      ];

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
      logger.error({ err: error }, 'Ошибка при запросе списка моделей к OpenAI API');
      return [];
    }
  }
}
