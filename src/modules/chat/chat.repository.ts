import { Collection, Db } from 'mongodb';
import { ChatDocument, ChatMessage, ChatSettings, Role } from './chat.types';

export class ChatRepository {
  private readonly collection: Collection<ChatDocument>;
  private readonly MAX_GPT_HISTORY = 10;
  private readonly MAX_CHATTERBOX_HISTORY = 15;

  constructor(db: Db) {
    this.collection = db.collection<ChatDocument>('chats');
  }

  public async getChat(chatId: number): Promise<ChatDocument | null> {
    return this.collection.findOne({ chatId });
  }

  public async ensureChatExists(chatId: number): Promise<ChatDocument> {
    const defaultSettings: ChatSettings = {
      isOpenAiEnabled: true,
      isChatterboxEnabled: false,
      llmSystemPrompt: 'Ты полезный ассистент.',
      chatterboxSystemPrompt: 'Ты саркастичный участник чата. Отвечай коротко и смешно.',
      openAiModel: 'gpt-4o-mini',
      chatterboxChance: 0.02,
      openAiApiKey: undefined,
    };

    const result = await this.collection.findOneAndUpdate(
      { chatId },
      {
        $setOnInsert: {
          chatId,
          settings: defaultSettings,
          gptMessages: [],
          chatterboxMessages: [],
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    return result as ChatDocument;
  }

  public async addGptMessage(chatId: number, role: Role, content: string): Promise<void> {
    const newMessage: ChatMessage = { role, content, timestamp: new Date() };
    await this.collection.updateOne(
      { chatId },
      {
        $push: {
          gptMessages: { $each: [newMessage], $slice: -this.MAX_GPT_HISTORY },
        },
      },
    );
  }

  public async addChatterboxMessage(chatId: number, role: Role, content: string): Promise<void> {
    const newMessage: ChatMessage = { role, content, timestamp: new Date() };
    await this.collection.updateOne(
      { chatId },
      {
        $push: {
          chatterboxMessages: { $each: [newMessage], $slice: -this.MAX_CHATTERBOX_HISTORY },
        },
      },
    );
  }
}
