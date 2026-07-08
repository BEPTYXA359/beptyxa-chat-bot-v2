import { FastifyRequest } from 'fastify';
import { z } from 'zod';

export const chatQuerySchema = z.object({
  chatId: z.coerce.number().optional(),
});

export function getTargetChatId(request: FastifyRequest): number {
  const userId = request.user?.id;

  if (!userId) {
    throw new Error('Попытка извлечь chat ID из неавторизованного запроса');
  }

  const query = chatQuerySchema.safeParse(request.query);
  return query.success && query.data.chatId ? query.data.chatId : userId;
}
