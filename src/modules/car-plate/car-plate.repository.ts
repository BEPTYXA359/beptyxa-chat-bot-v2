import { Collection, Db, ObjectId } from 'mongodb';
import { CarPlateDocument } from './car-plate.types';

export class CarPlateRepository {
  private readonly collection: Collection<CarPlateDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CarPlateDocument>('carPlates');
  }

  public async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ chatId: 1 });
    await this.collection.createIndex({ chatId: 1, plate: 1 }, { unique: true });
  }

  public async create(plate: CarPlateDocument): Promise<CarPlateDocument> {
    const result = await this.collection.insertOne(plate);
    plate._id = result.insertedId;
    return plate;
  }

  public async getByChat(chatId: number): Promise<CarPlateDocument[]> {
    return this.collection.find({ chatId }).sort({ createdAt: -1 }).toArray();
  }

  public async getById(id: string): Promise<CarPlateDocument | null> {
    return this.collection.findOne({ _id: new ObjectId(id) });
  }

  public async update(id: string, updateData: Partial<CarPlateDocument>): Promise<void> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
  }

  public async delete(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}
