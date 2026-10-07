import { FastifyPluginAsync } from 'fastify';
import { updateSettingsSchema } from '../types/settings.types';
import { ChatService } from '../../../modules/chat/chat.service';
import { logger } from '../../../shared/logger';
import { z } from 'zod';
import { getTargetChatId } from '../utils/request.util';
import { CHAT_LLM_PROVIDERS } from '../../../infrastructure/llm/llm-providers.registry';
import { GPTProvider } from '../../../modules/chat/chat.types';

export interface SettingsRoutesOptions {
  chatService: ChatService;
}

/** Список моделей ограничиваем, чтобы не раздувать ответ (у OpenRouter их сотни) */
const MAX_MODELS_PER_PROVIDER = 200;

/** Провайдеры, попадающие в настройки: Groq (без своего ключа) + все OpenAI-совместимые */
const SETTINGS_PROVIDERS: GPTProvider[] = ['Groq', ...CHAT_LLM_PROVIDERS.map((def) => def.id)];

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

      // Ключи не отдаём наружу — только факт наличия, модель и алиас
      const providers: Record<string, { hasApiKey: boolean; model?: string; alias?: string }> = {};
      for (const provider of SETTINGS_PROVIDERS) {
        const stored = chat.settings.llmProviders?.[provider];
        providers[provider] = {
          hasApiKey:
            provider === 'Groq'
              ? true
              : provider === 'OpenAi'
                ? !!(stored?.apiKey || chat.settings.openAiApiKey)
                : !!stored?.apiKey,
          model: stored?.model,
          alias: stored?.alias,
        };
      }

      // Плоский список моделей OpenAI — для обратной совместимости со старым миниаппом
      const openAiModels = (await chatService.getAvailableModels(targetChatId, 'OpenAi')).slice(
        0,
        MAX_MODELS_PER_PROVIDER,
      );

      const providerModels: Record<string, Array<string>> = { OpenAi: openAiModels };

      const providersWithKeys = CHAT_LLM_PROVIDERS.filter(
        (def) => def.id !== 'OpenAi' && chat.settings.llmProviders?.[def.id]?.apiKey,
      );

      const lists = await Promise.all(
        providersWithKeys.map((def) => chatService.getAvailableModels(targetChatId, def.id)),
      );
      providersWithKeys.forEach((def, index) => {
        providerModels[def.id] = lists[index].slice(0, MAX_MODELS_PER_PROVIDER);
      });

      return reply.send({
        isOpenAiEnabled: chat.settings.isOpenAiEnabled,
        isChatterboxEnabled: chat.settings.isChatterboxEnabled,
        isStreamingEnabled: chat.settings.isStreamingEnabled,
        hasOpenAiApiKey: providers.OpenAi.hasApiKey,
        llmSystemPrompt: chat.settings.llmSystemPrompt,
        chatterboxSystemPrompt: chat.settings.chatterboxSystemPrompt,
        openAiModel: providers.OpenAi.model || chat.settings.openAiModel,
        chatterboxChance: chat.settings.chatterboxChance,
        providers,
        availableModels: openAiModels,
        providerModels,
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
