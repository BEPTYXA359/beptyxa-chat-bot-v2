import { Db, Collection, ObjectId } from 'mongodb';
import { ReminderDocument } from './reminder.types';

export interface AgendaJobInfo {
  reminderId: string;
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

  public async delete(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }

  public async getAgendaJobs(jobName: string): Promise<AgendaJobInfo[]> {
    const docs = await this.agendaCollection
      .find(
        { name: jobName, 'data.reminderId': { $type: 'string' } },
        { projection: { 'data.reminderId': 1, nextRunAt: 1 } },
      )
      .toArray();

    return docs
      .map((doc) => {
        const reminderId = (doc as { data?: { reminderId?: string } }).data?.reminderId;
        if (typeof reminderId !== 'string') return null;
        const nextRunAt = (doc as { nextRunAt?: Date | null }).nextRunAt ?? null;
        return { reminderId, nextRunAt };
      })
      .filter((item): item is AgendaJobInfo => item !== null);
  }
}
