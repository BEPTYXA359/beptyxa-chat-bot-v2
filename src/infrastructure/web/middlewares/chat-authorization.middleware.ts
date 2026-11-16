import { FastifyReply, FastifyRequest } from 'fastify';
import { ChatService } from '../../../modules/chat/chat.service';
import { chatQuerySchema, getTargetChatId } from '../utils/request.util';

export const createChatAuthorizationHook =
  (chatService: ChatService) => async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized: пользователь не определён' });
    }

    const query = chatQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Некорректный chatId' });
    }

    const targetChatId = getTargetChatId(request);
    if (targetChatId === userId) return;
    if (targetChatId > 0) {
      return reply.status(403).send({ error: 'Нет доступа к чужому личному чату' });
    }

    const membership = await chatService.checkUserIsMember(targetChatId, userId);
    if (membership === 'member') return;

    if (membership === 'not_member') {
      return reply.status(403).send({ error: 'Нет доступа: вы не состоите в этом чате' });
    }

    return reply.status(403).send({
      error:
        'Telegram не смог подтвердить участие. Для управления через Mini App сделайте бота администратором чата',
    });
  };
