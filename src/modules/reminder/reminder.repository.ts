import { Db, Collection, ObjectId } from 'mongodb';
import { ReminderDocument, SteamSubscriber } from './reminder.types';

export interface AgendaJobInfo {
  reminderId: string;
  name: string;
  nextRunAt: Date | null;
}

export class ReminderRepository {
  private readonly collection: Collection<ReminderDocument>;
  private readonly agendaCollection: Collection;

  constructor(db: Db) {
    this.collection = db.collection<ReminderDocument>('reminders');
    this.agendaCollection = db.collection('agendaJobs');
  }

  public async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ chatId: 1 });
  }

  public async create(reminder: ReminderDocument): Promise<ReminderDocument> {
    const result = await this.collection.insertOne(reminder);
    reminder._id = result.insertedId;
    return reminder;
  }

  public async update(id: string, updateData: Partial<ReminderDocument>): Promise<void> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
  }

  public async getAll(): Promise<ReminderDocument[]> {
    return this.collection.find({}).toArray();
  }

  public async getActiveByChat(chatId: number): Promise<ReminderDocument[]> {
    return this.collection.find({ chatId }).sort({ createdAt: -1 }).toArray();
  }

  public async getById(id: string): Promise<ReminderDocument | null> {
    return this.collection.findOne({ _id: new ObjectId(id) });
  }

  public async findSteamReleaseReminder(
    chatId: number,
    steamAppId: string,
  ): Promise<ReminderDocument | null> {
    return this.collection.findOne({ chatId, kind: 'steam_release', steamAppId });
  }

  public async addSubscriber(id: string, subscriber: SteamSubscriber): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $push: { subscribers: subscriber } },
    );
  }

  public async getAllSteamReleaseReminders(): Promise<ReminderDocument[]> {
    return this.collection.find({ kind: 'steam_release' }).toArray();
  }

  public async delete(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }

  public async getAgendaJobs(): Promise<AgendaJobInfo[]> {
    const docs = await this.agendaCollection
      .find(
        { 'data.reminderId': { $type: 'string' } },
        { projection: { name: 1, 'data.reminderId': 1, nextRunAt: 1 } },
      )
      .toArray();

    return docs
      .map((doc) => {
        const reminderId = (doc as { data?: { reminderId?: string } }).data?.reminderId;
        if (typeof reminderId !== 'string') return null;
        const nextRunAt = (doc as { nextRunAt?: Date | null }).nextRunAt ?? null;
        const name = (doc as { name?: string }).name ?? '';
        return { reminderId, nextRunAt, name };
      })
      .filter((item): item is AgendaJobInfo => item !== null);
  }
}
