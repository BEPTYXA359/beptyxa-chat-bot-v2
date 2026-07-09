import { ChatRepository } from './chat.repository';
import { OpenAiProvider } from '../../infrastructure/llm/openai.provider';
import { ChatMessage, ChatSettings, GPTProvider } from './chat.types';
import { CryptoService } from '../../shared/services/crypto.service';
import { logger } from '../../shared/logger';
import { GroqProvider } from '../../infrastructure/llm/groq.provider';

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

export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly openaiProvider: OpenAiProvider,
    private readonly groqProvider: GroqProvider,
    private readonly cryptoService: CryptoService,
  ) {}

  public async recordChatterboxHistory(chatId: number, text: string): Promise<ChatSettings | null> {
    const chat = await this.chatRepository.getChat(chatId);

    if (!chat) return null;

    if (chat.settings.isChatterboxEnabled) {
      await this.chatRepository.addChatterboxMessage(chatId, 'user', text);
    }

    return chat.settings;
  }

  public async processGptRequest(
    chatId: number,
    prompt: string,
    provider: GPTProvider,
  ): Promise<string> {
    const chat = await this.chatRepository.ensureChatExists(chatId);

    if (provider === 'OpenAi') {
      if (!chat.settings.isOpenAiEnabled) {
        return 'Функция ChatGPT отключена в настройках этого чата.';
      }

      if (!chat.settings.openAiApiKey) {
        return 'У вас не настроен API ключ OpenAI! Добавьте его через Mini App.';
      }
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
      content: `${chat.settings.llmSystemPrompt || 'Ты полезный ассистент.'} Но твои ответы строго не должны превышать 3500 символов.`,
    });

    try {
      let reply = '';

      if (provider === 'OpenAi') {
        const decryptedKey = this.cryptoService.decrypt(chat.settings.openAiApiKey!);
        reply = await this.openaiProvider.generateText(
          messagesForLlm,
          decryptedKey,
          chat.settings.openAiModel,
        );
      } else if (provider === 'Groq') {
        reply = await this.groqProvider.generateText(messagesForLlm);
      } else {
        throw new Error(`Неизвестный провайдер: ${provider}`);
      }

      await this.chatRepository.addGptMessage(chatId, 'assistant', reply);
      return reply;
    } catch (error) {
      logger.error({ err: error, provider }, `Произошла ошибка при обращении к ${provider}`);
      return `Произошла ошибка при обращении к ${provider}. Попробуйте позже.`;
    }
  }

  public async *processGptRequestStream(
    chatId: number,
    prompt: string,
    provider: GPTProvider,
  ): AsyncIterable<string> {
    const chat = await this.chatRepository.ensureChatExists(chatId);

    if (provider === 'OpenAi' && !chat.settings.openAiApiKey) {
      yield 'У вас не настроен API ключ OpenAI! Добавьте его через Mini App.';
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
      content: `${chat.settings.llmSystemPrompt || 'Ты полезный ассистент.'} Но твои ответы строго не должны превышать 3500 символов.`,
    });

    let fullText = '';

    try {
      const stream =
        provider === 'OpenAi'
          ? await this.openaiProvider.generateTextStream(
              messagesForLlm,
              this.cryptoService.decrypt(chat.settings.openAiApiKey!),
              chat.settings.openAiModel,
            )
          : await this.groqProvider.generateTextStream(messagesForLlm);

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
      logger.error({ err: error, provider }, `Произошла ошибка при обращении к ${provider}`);

      if (fullText) {
        yield `\n\n[Ошибка: ответ получен не полностью]`;
      } else {
        yield `Произошла ошибка при обращении к ${provider}. Попробуйте позже.`;
        return;
      }
    }

    await this.chatRepository.addGptMessage(chatId, 'user', prompt);
    await this.chatRepository.addGptMessage(chatId, 'assistant', fullText);
  }

  public async triggerChatterboxReply(chatId: number, text: string): Promise<string | null> {
    const chat = await this.chatRepository.getChat(chatId);

    if (!chat || !chat.settings.isChatterboxEnabled || !chat.settings.openAiApiKey) {
      return null;
    }

    if (chat.chatterboxMessages.length === 0) return null;

    const decryptedKey = this.cryptoService.decrypt(chat.settings.openAiApiKey);

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
        chat.settings.openAiModel,
      );

      await this.chatRepository.addChatterboxMessage(chatId, 'assistant', reply);
      return reply;
    } catch (error) {
      logger.error({ err: error }, 'Произошла ошибка при использовании chatterbox');
      return null;
    }
  }

  public async parseCurrency(query: string) {
    return this.groqProvider.parseCurrencyQuery(query);
  }

  public async getChatInfo(chatId: number) {
    return this.chatRepository.ensureChatExists(chatId);
  }

  public async updateSettings(chatId: number, updates: Partial<ChatSettings>) {
    const chat = await this.chatRepository.ensureChatExists(chatId);

    if (!chat) {
      throw new Error('Чат не найден');
    }

    if (updates.openAiApiKey) {
      updates.openAiApiKey = this.cryptoService.encrypt(updates.openAiApiKey);
    }

    await this.chatRepository.updateChatSettings(chatId, updates);
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

  public async getAvailableModels(chatId: number): Promise<Array<string>> {
    const chat = await this.chatRepository.getChat(chatId);

    if (!chat || !chat.settings.openAiApiKey) {
      return [];
    }

    try {
      const decryptedKey = this.cryptoService.decrypt(chat.settings.openAiApiKey);

      return await this.openaiProvider.getAvailableTextModels(decryptedKey);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Ошибка при получении или расшифровке моделей OpenAI');
      return [];
    }
  }
}
