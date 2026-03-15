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
}
