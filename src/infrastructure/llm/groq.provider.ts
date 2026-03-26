import Groq from 'groq-sdk';
import { logger } from '../../shared/logger';
import { ChatMessage } from '../../modules/chat/chat.types';
import { config } from '../../shared/config';
import { CurrencyParseResult, currencyParseSchema } from '../../modules/converter/currency.types';
import { z } from 'zod';

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

  public async parseCurrencyQuery(query: string): Promise<CurrencyParseResult | null> {
    try {
      const response = await this.client.chat.completions.create({
        model: config.GROQ_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Ты — парсер валют. Твоя задача — извлечь сумму, исходную валюту и целевую валюту из текста.
ОТВЕЧАЙ СТРОГО В ФОРМАТЕ JSON, БЕЗ ЛИШНИХ СЛОВ: {"amount": число, "from": "ISO код", "to": "ISO код"}.
Правила:
1. Коды валют строго в ISO 4217 (например: USD, EUR, RUB, KZT, GEL).
2. Если целевая валюта не указана, используй "RUB".
3. "бакс", "доллар" = USD. "евро" = EUR. "рубль", "деревянный" = RUB. "юань" = CNY. "косарь", "тыща" = 1000. "полтинник" = 50. "пятихат" = 500 и тд
Пример: "переведи 150 баксов" -> {"amount": 150, "from": "USD", "to": "RUB"}
Пример: "50 евро в тенге" -> {"amount": 50, "from": "EUR", "to": "KZT"}`,
          },
          { role: 'user', content: query },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      const rawJson = JSON.parse(content);
      const validationResult = currencyParseSchema.safeParse(rawJson);

      if (!validationResult.success) {
        logger.warn(
          { err: z.treeifyError(validationResult.error), content },
          'Groq вернул данные, не соответствующие Zod-схеме',
        );
        return null;
      }

      return validationResult.data;
    } catch (error) {
      logger.error({ err: error }, 'Ошибка парсинга JSON валюты через Groq');
      return null;
    }
  }
}
