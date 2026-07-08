import { Db, Collection, ObjectId } from 'mongodb';
import { ReminderDocument } from './reminder.types';

export class ReminderRepository {
  private readonly collection: Collection<ReminderDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ReminderDocument>('reminders');
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
}
