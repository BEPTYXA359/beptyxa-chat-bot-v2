import { ChatRepository } from './chat.repository';
import {
  OpenAiProvider,
  LlmUsageCallback,
  LlmCallOptions,
} from '../../infrastructure/llm/openai.provider';
import {
  ChatDocument,
  ChatMessage,
  ChatSettings,
  GPTProvider,
  LlmProviderSettings,
} from './chat.types';
import { CryptoService } from '../../shared/services/crypto.service';
import { logger } from '../../shared/logger';
import { GroqProvider } from '../../infrastructure/llm/groq.provider';
import { LlmUsageService } from '../llm-usage/llm-usage.service';
import { LlmUsageProvider, LlmUsageSource } from '../llm-usage/llm-usage.types';
import { getProviderDef } from '../../infrastructure/llm/llm-providers.registry';

interface TelegramChatMemberResponse {
  ok: boolean;
  result?: {
    status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  };
  description?: string;
}

interface CacheEntry {
  isAdmin: boolean;
  expiresAt: number;
}
const adminCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

interface ModelsCacheEntry {
  models: Array<string>;
  expiresAt: number;
}
const modelsCache = new Map<string, ModelsCacheEntry>();
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

interface ResolvedLlmConfig {
  apiKey: string | null;
  model: string;
  call: LlmCallOptions;
}

export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly openaiProvider: OpenAiProvider,
    private readonly groqProvider: GroqProvider,
    private readonly cryptoService: CryptoService,
    private readonly llmUsageService: LlmUsageService,
  ) {}

  private usageRecorder(chatId: number, source: LlmUsageSource): LlmUsageCallback {
    return (usage) => void this.llmUsageService.record(chatId, usage, source);
  }

  /**
   * Ключ, модель и параметры соединения для провайдера.
   * Для OpenAi хранилище — llmProviders.OpenAi с фолбэком на старые поля openAiApiKey/openAiModel.
   */
  private resolveLlmConfig(settings: ChatSettings, provider: GPTProvider): ResolvedLlmConfig {
    const def = getProviderDef(provider);
    const stored = settings.llmProviders?.[provider];

    if (provider === 'Groq') {
      return { apiKey: 'server', model: 'groq', call: { provider } };
    }

    const apiKey =
      provider === 'OpenAi'
        ? (stored?.apiKey ?? settings.openAiApiKey ?? null)
        : (stored?.apiKey ?? null);

    const model =
      provider === 'OpenAi'
        ? stored?.model || settings.openAiModel || def.defaultModel
        : stored?.model || def.defaultModel;

    return {
      apiKey,
      model,
      call: { provider, baseUrl: def.baseUrl, includeUsage: def.supportsStreamOptions },
    };
  }

  /** История балабола; chat — предзагруженный документ, чтобы не читать БД повторно */
  public async recordChatterboxHistory(
    chatId: number,
    text: string,
    chat?: ChatDocument | null,
  ): Promise<ChatSettings | null> {
    const chatDocument = chat ?? (await this.chatRepository.getChat(chatId));

    if (!chatDocument) return null;

    if (chatDocument.settings.isChatterboxEnabled) {
      await this.chatRepository.addChatterboxMessage(chatId, 'user', text);
    }

    return chatDocument.settings;
  }

  public async processGptRequest(
    chatId: number,
    prompt: string,
    provider: GPTProvider,
  ): Promise<string> {
    const chat = await this.chatRepository.ensureChatExists(chatId);
    const def = getProviderDef(provider);

    if (provider === 'OpenAi' && !chat.settings.isOpenAiEnabled) {
      return 'Функция ChatGPT отключена в настройках этого чата.';
    }

    const config = this.resolveLlmConfig(chat.settings, provider);

    if (!config.apiKey) {
      return `У вас не настроен API ключ ${def.displayName}! Добавьте его через Mini App.`;
    }

    await this.chatRepository.addGptMessage(chatId, 'user', prompt);

    const messagesForLlm: Omit<ChatMessage, 'timestamp'>[] = chat.gptMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    messagesForLlm.push({
      role: 'user',
      content: prompt,
    });

    messagesForLlm.unshift({
      role: 'system',
      content: `${chat.settings.llmSystemPrompt || 'Ты полезный ассистент.'}`,
    });

    try {
      const usageRecorder = this.usageRecorder(chatId, 'chat');

      const reply =
        provider === 'Groq'
          ? await this.groqProvider.generateText(messagesForLlm, usageRecorder)
          : await this.openaiProvider.generateText(
              messagesForLlm,
              this.cryptoService.decrypt(config.apiKey),
              config.model,
              usageRecorder,
              config.call,
            );

      await this.chatRepository.addGptMessage(chatId, 'assistant', reply);
      return reply;
    } catch (error) {
      logger.error({ err: error, provider }, `Произошла ошибка при обращении к ${def.displayName}`);
      return `Произошла ошибка при обращении к ${def.displayName}. Попробуйте позже.`;
    }
  }

  public async *processGptRequestStream(
    chatId: number,
    prompt: string,
    provider: GPTProvider,
  ): AsyncIterable<string> {
    const chat = await this.chatRepository.ensureChatExists(chatId);
    const def = getProviderDef(provider);
    const config = this.resolveLlmConfig(chat.settings, provider);

    if (!config.apiKey) {
      yield `У вас не настроен API ключ ${def.displayName}! Добавьте его через Mini App.`;
      return;
    }

    const messagesForLlm: Omit<ChatMessage, 'timestamp'>[] = chat.gptMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    messagesForLlm.push({
      role: 'user',
      content: prompt,
    });

    messagesForLlm.unshift({
      role: 'system',
      content: `${chat.settings.llmSystemPrompt || 'Ты полезный ассистент.'}`,
    });

    let fullText = '';

    try {
      const usageRecorder = this.usageRecorder(chatId, 'chat');

      const stream =
        provider === 'Groq'
          ? await this.groqProvider.generateTextStream(messagesForLlm, usageRecorder)
          : await this.openaiProvider.generateTextStream(
              messagesForLlm,
              this.cryptoService.decrypt(config.apiKey),
              config.model,
              usageRecorder,
              config.call,
            );

      let buffer = '';
      for await (const chunk of stream) {
        fullText += chunk;
        buffer += chunk;
        if (!/[\p{L}\p{N}]/u.test(buffer)) continue;
        yield buffer;
        buffer = '';
      }
      if (buffer) yield buffer;
    } catch (error) {
      logger.error({ err: error, provider }, `Произошла ошибка при обращении к ${def.displayName}`);

      if (fullText) {
        yield `\n\n[Ошибка: ответ получен не полностью]`;
      } else {
        yield `Произошла ошибка при обращении к ${def.displayName}. Попробуйте позже.`;
        return;
      }
    }

    await this.chatRepository.addGptMessage(chatId, 'user', prompt);
    await this.chatRepository.addGptMessage(chatId, 'assistant', fullText);
  }

  public async triggerChatterboxReply(chatId: number, text: string): Promise<string | null> {
    const chat = await this.chatRepository.getChat(chatId);

    if (!chat || !chat.settings.isChatterboxEnabled) {
      return null;
    }

    const config = this.resolveLlmConfig(chat.settings, 'OpenAi');
    if (!config.apiKey) return null;

    if (chat.chatterboxMessages.length === 0) return null;

    const decryptedKey = this.cryptoService.decrypt(config.apiKey);

    const messagesForLlm: Omit<ChatMessage, 'timestamp'>[] = chat.chatterboxMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    messagesForLlm.push({
      role: 'user',
      content: text,
    });

    messagesForLlm.unshift({
      role: 'system',
      content:
        chat.settings.chatterboxSystemPrompt ||
        'Ты саркастичный участник чата. Отвечай коротко и смешно.',
    });

    try {
      const reply = await this.openaiProvider.generateText(
        messagesForLlm,
        decryptedKey,
        config.model,
        this.usageRecorder(chatId, 'chatterbox'),
        config.call,
      );

      await this.chatRepository.addChatterboxMessage(chatId, 'assistant', reply);
      return reply;
    } catch (error) {
      logger.error({ err: error }, 'Произошла ошибка при использовании chatterbox');
      return null;
    }
  }

  public async processGptRequestSimple(query: string, scopeId?: number): Promise<string> {
    const messages: Omit<ChatMessage, 'timestamp'>[] = [
      {
        role: 'system',
        content: 'Ты полезный ассистент. Отвечай кратко, не более 3-4 предложений.',
      },
      { role: 'user', content: query },
    ];
    return this.groqProvider.generateText(
      messages,
      scopeId ? this.usageRecorder(scopeId, 'inline_chat') : undefined,
    );
  }

  public async parseCurrency(query: string, scopeId?: number) {
    return this.groqProvider.parseCurrencyQuery(
      query,
      scopeId ? this.usageRecorder(scopeId, 'currency_parse') : undefined,
    );
  }

  public async getChatInfo(chatId: number) {
    return this.chatRepository.ensureChatExists(chatId);
  }

  /** Чат без создания документа — для проверки триггеров на каждом сообщении */
  public async peekChat(chatId: number) {
    return this.chatRepository.getChat(chatId);
  }

  public async updateSettings(chatId: number, updates: Partial<ChatSettings>) {
    const chat = await this.chatRepository.ensureChatExists(chatId);

    if (!chat) {
      throw new Error('Чат не найден');
    }

    if (updates.openAiApiKey) {
      updates.openAiApiKey = this.cryptoService.encrypt(updates.openAiApiKey);
    }

    if (updates.llmProviders) {
      updates.llmProviders = this.mergeLlmProviders(chat.settings, updates.llmProviders);
    }

    await this.chatRepository.updateChatSettings(chatId, updates);
  }

  /**
   * Дополняет сохранённые настройки провайдеров входящими.
   * Пустой apiKey = «ключ не трогаем», пустой alias/model = сброс значения.
   */
  private mergeLlmProviders(
    settings: ChatSettings,
    incoming: Partial<Record<LlmUsageProvider, LlmProviderSettings>>,
  ): Partial<Record<LlmUsageProvider, LlmProviderSettings>> {
    const merged: Partial<Record<LlmUsageProvider, LlmProviderSettings>> = {
      ...(settings.llmProviders ?? {}),
    };

    for (const [providerId, patch] of Object.entries(incoming)) {
      const id = providerId as LlmUsageProvider;
      const next: LlmProviderSettings = { ...(merged[id] ?? {}) };

      if (patch.apiKey !== undefined) {
        const trimmedKey = patch.apiKey.trim();
        if (trimmedKey) {
          next.apiKey = this.cryptoService.encrypt(trimmedKey);
        }
      }

      if (patch.model !== undefined) {
        const trimmedModel = patch.model.trim();
        if (trimmedModel) {
          next.model = trimmedModel;
        } else {
          delete next.model;
        }
      }

      if (patch.alias !== undefined) {
        const trimmedAlias = patch.alias.trim();
        if (trimmedAlias) {
          next.alias = trimmedAlias;
        } else {
          delete next.alias;
        }
      }

      if (Object.keys(next).length === 0) {
        delete merged[id];
      } else {
        merged[id] = next;
      }
    }

    return merged;
  }

  async checkUserIsAdmin(chatId: number, userId: number): Promise<boolean> {
    const cacheKey = `${chatId}:${userId}`;
    const now = Date.now();

    const cached = adminCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.isAdmin;
    }

    try {
      const botToken = process.env.BOT_TOKEN;
      if (!botToken) {
        throw new Error('Критическая ошибка: BOT_TOKEN не задан в переменных окружения');
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${chatId}&user_id=${userId}`,
      );

      const data = (await response.json()) as TelegramChatMemberResponse;

      if (!data.ok || !data.result) {
        logger.warn(
          { chatId, userId, data },
          'Telegram API вернул ошибку при проверке прав пользователя',
        );
        return false;
      }

      const status = data.result.status;
      const isAdmin = status === 'creator' || status === 'administrator';

      adminCache.set(cacheKey, {
        isAdmin,
        expiresAt: now + CACHE_TTL_MS,
      });

      if (adminCache.size > 1000) {
        adminCache.clear();
      }

      return isAdmin;
    } catch (error) {
      logger.error(
        { err: error, chatId, userId },
        'Ошибка сети при запросе getChatMember к Telegram API',
      );
      return false;
    }
  }

  public async getAvailableModels(
    chatId: number,
    provider: GPTProvider = 'OpenAi',
  ): Promise<Array<string>> {
    const cacheKey = `${chatId}:${provider}`;
    const now = Date.now();

    const cached = modelsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.models;
    }

    const chat = await this.chatRepository.getChat(chatId);

    if (!chat) {
      return [];
    }

    const config = this.resolveLlmConfig(chat.settings, provider);
    if (!config.apiKey || provider === 'Groq') {
      return [];
    }

    try {
      const decryptedKey = this.cryptoService.decrypt(config.apiKey);

      const models = await this.openaiProvider.getAvailableTextModels(decryptedKey, config.call);

      modelsCache.set(cacheKey, { models, expiresAt: now + MODELS_CACHE_TTL_MS });
      if (modelsCache.size > 500) {
        modelsCache.clear();
      }

      return models;
    } catch (error) {
      logger.error(
        { err: error, chatId, provider },
        'Ошибка при получении или расшифровке моделей провайдера',
      );
      return [];
    }
  }
}
