import { FastifyPluginAsync } from 'fastify';
import { LlmUsageService } from '../../../modules/llm-usage/llm-usage.service';
import { ChatService } from '../../../modules/chat/chat.service';
import { getTargetChatId } from '../utils/request.util';
import { logger } from '../../../shared/logger';

export interface LlmUsageRoutesOptions {
  llmUsageService: LlmUsageService;
  chatService: ChatService;
}

export const llmUsageRoutes: FastifyPluginAsync<LlmUsageRoutesOptions> = async (
  fastify,
  options,
) => {
  const { llmUsageService, chatService } = options;

  fastify.get('/', async (request, reply) => {
    const userId = request.user!.id;
    const targetChatId = getTargetChatId(request);

    try {
      if (targetChatId !== userId) {
        const isAdmin = await chatService.checkUserIsAdmin(targetChatId, userId);
        if (!isAdmin) {
          return reply
            .status(403)
            .send({ error: 'Только администраторы могут смотреть статистику чата' });
        }
      }

      const summary = await llmUsageService.getSummary(targetChatId);
      return reply.send(summary);
    } catch (error) {
      logger.error({ err: error, targetChatId }, 'Ошибка получения статистики LLM');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });
};
