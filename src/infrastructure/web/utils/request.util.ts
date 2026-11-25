import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

const chatIdSchema = z.coerce
  .number()
  .int()
  .refine((value) => value !== 0);

export const chatQuerySchema = z
  .object({
    chatId: chatIdSchema.optional(),
  })
  .default({});

export const chatPathSchema = z
  .object({
    chatId: chatIdSchema.optional(),
  })
  .default({});

export class ChatIdMismatchError extends Error {
  constructor() {
    super('chatId в path и query должен совпадать');
    this.name = 'ChatIdMismatchError';
  }
}

export function getTargetChatId(request: FastifyRequest): number {
  const userId = request.user?.id;
  if (!userId) throw new Error('Попытка извлечь chat ID из неавторизованного запроса');

  const query = chatQuerySchema.parse(request.query);
  const params = chatPathSchema.parse(request.params);
  if (query.chatId !== undefined && params.chatId !== undefined && query.chatId !== params.chatId) {
    throw new ChatIdMismatchError();
  }
  return params.chatId ?? query.chatId ?? userId;
}
