import { z } from 'zod';
import { GroqProvider } from '../../infrastructure/llm/groq.provider';
import { logger } from '../../shared/logger';
import { RouterResult } from './inline.types';

const routerResponseSchema = z.object({
  intent: z.enum(['currency_convert', 'ai_chat']),
  confidence: z.number().min(0).max(1),
  amount: z.number().nonnegative().optional().nullable(),
  from: z.string().toUpperCase().optional().nullable(),
  to: z.string().toUpperCase().optional().nullable(),
});

const ROUTER_SYSTEM_PROMPT = `Ты — роутер запросов. Определи intent запроса.

Варианты:
- currency_convert — конвертация валют (есть число и код валюты)
- ai_chat — общий вопрос, разговор, всё остальное

Для currency_convert извлеки amount (число), from (ISO 4217), to (ISO 4217, по умолчанию RUB).
Правила:
- "бакс", "доллар" = USD. "евро" = EUR. "рубль", "деревянный" = RUB. "тенге" = KZT. "юань" = CNY
- Если целевая валюта не указана, to = "RUB"
- "косарь" = 1000. "полтинник" = 50. "пятихатка" = 500

НЕ currency_convert: "история доллара", "курс валют", "сколько стоит биткоин"
НЕ ai_chat: "конвертер 100 евро", "100 баксов", "50 usd в руб"

Ответь строго JSON без лишних слов:
{"intent": "currency_convert"|"ai_chat", "confidence": 0.0-1.0, "amount": null|число, "from": null|string, "to": null|string}`;

const STEAM_LINK_REGEX = /store\.steampowered\.com\/app\/(\d+)/i;
const CURRENCY_NUMBER_REGEX = /^\d+\s*(usd|eur|rub|kzt|gel|cny|бакс|доллар|евро|руб|тенге|юань)/i;
const CURRENCY_COMMAND_REGEX = /^конвертер\s+/i;

export class QueryRouterService {
  constructor(private readonly groqProvider: GroqProvider) {}

  public async route(query: string): Promise<RouterResult> {
    const trimmed = query.trim();

    const fastResult = this.fastPath(trimmed);
    if (fastResult) return fastResult;

    return this.groqRoute(trimmed);
  }

  private fastPath(query: string): RouterResult | null {
    const steamMatch = query.match(STEAM_LINK_REGEX);
    if (steamMatch) {
      return {
        intent: 'steam_info',
        confidence: 1,
        rawQuery: query,
        steamAppId: steamMatch[1],
      };
    }

    if (CURRENCY_NUMBER_REGEX.test(query) || CURRENCY_COMMAND_REGEX.test(query)) {
      return {
        intent: 'currency_convert',
        confidence: 0.9,
        rawQuery: query,
      };
    }

    return null;
  }

  private async groqRoute(query: string): Promise<RouterResult> {
    try {
      const result = await this.groqProvider.generateStructured(
        ROUTER_SYSTEM_PROMPT,
        query,
        routerResponseSchema,
      );

      if (!result || result.confidence < 0.5) {
        return { intent: 'ai_chat', confidence: 0.5, rawQuery: query };
      }

      return {
        intent: result.intent,
        confidence: result.confidence,
        rawQuery: query,
        amount: result.amount ?? undefined,
        from: result.from ?? undefined,
        to: result.to ?? undefined,
      };
    } catch (error) {
      logger.error({ err: error, query }, 'QueryRouter: ошибка классификации через Groq');
      return { intent: 'ai_chat', confidence: 0, rawQuery: query };
    }
  }
}
