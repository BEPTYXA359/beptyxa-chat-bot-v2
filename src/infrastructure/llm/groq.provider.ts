import Groq from 'groq-sdk';
import { logger } from '../../shared/logger';
import { ChatMessage } from '../../modules/chat/chat.types';
import { config } from '../../shared/config';

export class GroqProvider {
  private readonly client: Groq;

  constructor() {
    this.client = new Groq({ apiKey: config.GROQ_API_KEY });
  }

  public async generateText(messages: Omit<ChatMessage, 'timestamp'>[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: config.GROQ_MODEL,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      return response.choices[0]?.message?.content || 'Извините, я не смог сгенерировать ответ.';
    } catch (error) {
      logger.error({ err: error }, 'Ошибка при запросе к Groq');
      throw new Error('Не удалось получить ответ от Groq');
    }
  }
}
