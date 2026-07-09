import OpenAI from 'openai';
import { logger } from '../../shared/logger';
import { ChatMessage } from '../../modules/chat/chat.types';

export class OpenAiProvider {
  public async generateText(
    messages: Omit<ChatMessage, 'timestamp'>[],
    apiKey: string,
    model: string,
  ): Promise<string> {
    try {
      const client = new OpenAI({ apiKey });

      const response = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

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
  ): AsyncIterable<string> {
    const client = new OpenAI({ apiKey });

    const stream = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
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
