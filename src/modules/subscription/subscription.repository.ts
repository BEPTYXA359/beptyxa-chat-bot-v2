import { Collection, Db, ObjectId } from 'mongodb';
import { SubscriptionDocument } from './subscription.types';

export class SubscriptionRepository {
  private readonly collection: Collection<SubscriptionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<SubscriptionDocument>('subscriptions');
  }

  public async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ chatId: 1 });
    await this.collection.createIndex({ nextPaymentDate: 1 });
  }

  public async create(subscription: SubscriptionDocument): Promise<SubscriptionDocument> {
    const result = await this.collection.insertOne(subscription);
    subscription._id = result.insertedId;
    return subscription;
  }

  public async getByChat(chatId: number): Promise<SubscriptionDocument[]> {
    return this.collection.find({ chatId }).sort({ nextPaymentDate: 1 }).toArray();
  }

  public async getAll(): Promise<SubscriptionDocument[]> {
    return this.collection.find({}).sort({ nextPaymentDate: 1 }).toArray();
  }

  public async getById(id: string): Promise<SubscriptionDocument | null> {
    return this.collection.findOne({ _id: new ObjectId(id) });
  }

  public async update(id: string, updateData: Partial<SubscriptionDocument>): Promise<void> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
  }

  public async delete(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}
