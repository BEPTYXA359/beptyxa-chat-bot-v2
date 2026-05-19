import { FastifyPluginAsync } from 'fastify';
import { updateSettingsSchema } from '../types/settings.types';
import { ChatService } from '../../../modules/chat/chat.service';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

export interface SettingsRoutesOptions {
  chatService: ChatService;
}

const querySchema = z.object({
  chatId: z.coerce.number().optional(), // coerce преобразует строку из URL в число
});

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { chatService } = options;

  fastify.get('/me', async (request, reply) => {
    const user = request.user!;
    return {
      message: `Привет, ${user.first_name}!`,
      userId: user.id,
      username: user.username,
    };
  });

  fastify.get('/', async (request, reply) => {
    const userId = request.user!.id;
    const query = querySchema.safeParse(request.query);

    const targetChatId = query.success && query.data.chatId ? query.data.chatId : userId;

    try {
      if (targetChatId !== userId) {
        const isAdmin = await chatService.checkUserIsAdmin(targetChatId, userId);
        if (!isAdmin) {
          return reply
            .status(403)
            .send({ error: 'Только администраторы могут менять настройки группы' });
        }
      }

      const chat = await chatService.getChatInfo(targetChatId);

      if (!chat) {
        return reply.status(404).send({ error: 'Чат не найден' });
      }

      return reply.send({
        isOpenAiEnabled: chat.settings.isOpenAiEnabled,
        isChatterboxEnabled: chat.settings.isChatterboxEnabled,
        hasOpenAiApiKey: !!chat.settings.openAiApiKey,
        llmSystemPrompt: chat.settings.llmSystemPrompt,
        chatterboxSystemPrompt: chat.settings.chatterboxSystemPrompt,
        openAiModel: chat.settings.openAiModel,
        chatterboxChance: chat.settings.chatterboxChance,
      });
    } catch (error) {
      logger.error({ err: error, userId }, 'Ошибка получения настроек');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.post('/', async (request, reply) => {
    const userId = request.user!.id;
    const query = querySchema.safeParse(request.query);
    const targetChatId = query.success && query.data.chatId ? query.data.chatId : userId;

    const validationResult = updateSettingsSchema.safeParse(request.body);

    if (!validationResult.success) {
      return reply.status(400).send({
        error: 'Неверный формат данных',
        details: z.treeifyError(validationResult.error),
      });
    }

    try {
      if (targetChatId !== userId) {
        const isAdmin = await chatService.checkUserIsAdmin(targetChatId, userId);
        if (!isAdmin) {
          return reply.status(403).send({ error: 'Нет прав на изменение настроек группы' });
        }
      }

      await chatService.updateSettings(targetChatId, validationResult.data);
      return reply.send({ success: true, message: 'Настройки успешно обновлены' });
    } catch (error) {
      logger.error({ err: error, userId }, 'Ошибка обновления настроек');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });
};
