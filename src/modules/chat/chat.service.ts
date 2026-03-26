import { ChatRepository } from './chat.repository';
import { OpenAiProvider } from '../../infrastructure/llm/openai.provider';
import { ChatMessage, ChatSettings, GPTProvider } from './chat.types';
import { CryptoService } from '../../shared/services/crypto.service';
import { logger } from '../../shared/logger';
import { GroqProvider } from '../../infrastructure/llm/groq.provider';

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
}
