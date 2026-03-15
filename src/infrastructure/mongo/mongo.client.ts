import { MongoClient, Db } from 'mongodb';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

export class Database {
  private static instance: Database;
  private client: MongoClient;
  private db: Db;

  private constructor() {
    this.client = new MongoClient(config.MONGO_URI);
    this.db = this.client.db(config.MONGO_DB_NAME);
  }

  public static async getInstance(): Promise<Database> {
    if (!Database.instance) {
      Database.instance = new Database();
      try {
        await Database.instance.client.connect();
        logger.info('Успешное подключение к MongoDB 🟢');
      } catch (error) {
        logger.fatal({ err: error }, 'Ошибка подключения к MongoDB 🔴');
        process.exit(1);
      }
    }
    return Database.instance;
  }

  public getDb(): Db {
    return this.db;
  }

  public async close(): Promise<void> {
    await this.client.close();
    logger.info('Соединение с MongoDB закрыто ⚪');
  }
}
