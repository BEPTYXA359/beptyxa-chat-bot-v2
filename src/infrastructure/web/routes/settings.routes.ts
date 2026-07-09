import { FastifyPluginAsync } from 'fastify';
import { updateSettingsSchema } from '../types/settings.types';
import { ChatService } from '../../../modules/chat/chat.service';
import { logger } from '../../../shared/logger';
import { z } from 'zod';
import { getTargetChatId } from '../utils/request.util';

export interface SettingsRoutesOptions {
  chatService: ChatService;
}

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { chatService } = options;

  fastify.get('/', async (request, reply) => {
    const userId = request.user!.id;
    const targetChatId = getTargetChatId(request);

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

      let availableModels: Array<string> = [];
      if (chat.settings.openAiApiKey) {
        availableModels = await chatService.getAvailableModels(targetChatId);
      }

      return reply.send({
        isOpenAiEnabled: chat.settings.isOpenAiEnabled,
        isChatterboxEnabled: chat.settings.isChatterboxEnabled,
        isStreamingEnabled: chat.settings.isStreamingEnabled,
        hasOpenAiApiKey: !!chat.settings.openAiApiKey,
        llmSystemPrompt: chat.settings.llmSystemPrompt,
        chatterboxSystemPrompt: chat.settings.chatterboxSystemPrompt,
        openAiModel: chat.settings.openAiModel,
        chatterboxChance: chat.settings.chatterboxChance,
        availableModels,
      });
    } catch (error) {
      logger.error({ err: error, userId }, 'Ошибка получения настроек');
      return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
    }
  });

  fastify.post('/', async (request, reply) => {
    const userId = request.user!.id;
    const targetChatId = getTargetChatId(request);

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
