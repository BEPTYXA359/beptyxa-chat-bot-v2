export const INTENTS = ['currency_convert', 'ai_chat', 'steam_info', 'unknown'] as const;
export type Intent = typeof INTENTS[number];

export interface RouterResult {
  intent: Exclude<Intent, 'unknown'>;
  confidence: number;
  rawQuery: string;
  amount?: number;
  from?: string;
  to?: string;
  steamAppId?: string;
}
