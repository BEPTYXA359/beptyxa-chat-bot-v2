import Groq from 'groq-sdk';
import { logger } from '../../shared/logger';
import { ChatMessage } from '../../modules/chat/chat.types';
import { config } from '../../shared/config';
import { CurrencyParseResult, currencyParseSchema } from '../../modules/currency/currency.types';
import { LlmTokenUsage } from '../../modules/llm-usage/llm-usage.types';
import { LlmUsageCallback } from './openai.provider';
import { z } from 'zod';

export class GroqProvider {
  private readonly client: Groq;

  constructor() {
    this.client = new Groq({ apiKey: config.GROQ_API_KEY });
  }

  public async generateText(
    messages: Omit<ChatMessage, 'timestamp'>[],
    onUsage?: LlmUsageCallback,
  ): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: config.GROQ_MODEL,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      if (onUsage) {
        onUsage(this.toTokenUsage(response.usage));
      }

      return response.choices[0]?.message?.content || 'Извините, я не смог сгенерировать ответ.';
    } catch (error) {
      logger.error({ err: error }, 'Ошибка при запросе к Groq');
      throw new Error('Не удалось получить ответ от Groq');
    }
  }

  public async *generateTextStream(
    messages: Omit<ChatMessage, 'timestamp'>[],
    onUsage?: LlmUsageCallback,
  ): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: config.GROQ_MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    let reported = false;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;

      // Groq присылает usage в x_groq последнего чанка стрима
      const usage = chunk.x_groq?.usage;
      if (onUsage && usage) {
        onUsage(this.toTokenUsage(usage));
        reported = true;
      }
    }

    if (onUsage && !reported) {
      onUsage({ provider: 'Groq', model: config.GROQ_MODEL, promptTokens: 0, completionTokens: 0 });
    }
  }

  public async generateStructured<T>(
    systemPrompt: string,
    userMessage: string,
    schema: z.ZodSchema<T>,
    onUsage?: LlmUsageCallback,
  ): Promise<T | null> {
    try {
      const response = await this.client.chat.completions.create({
        model: config.GROQ_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      if (onUsage) {
        onUsage(this.toTokenUsage(response.usage));
      }

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      const raw = JSON.parse(content);
      const parsed = schema.safeParse(raw);

      if (!parsed.success) {
        logger.warn(
          { err: parsed.error.format(), content },
          'generateStructured: Groq вернул данные, не соответствующие Zod-схеме',
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      logger.error({ err: error }, 'generateStructured: ошибка при запросе к Groq');
      return null;
    }
  }

  public async parseCurrencyQuery(
    query: string,
    onUsage?: LlmUsageCallback,
  ): Promise<CurrencyParseResult | null> {
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

      if (onUsage) {
        onUsage(this.toTokenUsage(response.usage));
      }

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

  private toTokenUsage(
    usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined,
  ): LlmTokenUsage {
    return {
      provider: 'Groq',
      model: config.GROQ_MODEL,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
    };
  }
}
