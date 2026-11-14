import { MongoServerError, ObjectId } from 'mongodb';
import { CarPlateRepository } from './car-plate.repository';
import { CarPlateDocument, CreateCarPlateDto } from './car-plate.types';
import { TelegramUser } from '../../shared/types/telegram.types';

const DUPLICATE_KEY_ERROR_CODE = 11000;

export class CarPlateNotFoundError extends Error {
  constructor() {
    super('Номер не найден');
    this.name = 'CarPlateNotFoundError';
  }
}

export class DuplicatePlateError extends Error {
  constructor() {
    super('Этот номер уже сохранён в этом чате');
    this.name = 'DuplicatePlateError';
  }
}

export class CarPlateService {
  constructor(private readonly repository: CarPlateRepository) {}

  public async getPlates(chatId: number): Promise<CarPlateDocument[]> {
    return this.repository.getByChat(chatId);
  }

  public async createPlate(
    chatId: number,
    creator: TelegramUser,
    dto: CreateCarPlateDto,
  ): Promise<void> {
    try {
      await this.repository.create({
        chatId,
        plate: dto.plate,
        name: dto.name,
        format: 'ru',
        createdAt: new Date(),
        createdBy: creator.id,
        creatorFirstName: creator.first_name,
        creatorUsername: creator.username,
      });
    } catch (error) {
      throw this.wrapDuplicate(error);
    }
  }

  private async findOwnedPlate(plateId: string, chatId: number): Promise<CarPlateDocument> {
    if (!ObjectId.isValid(plateId)) throw new CarPlateNotFoundError();
    const plate = await this.repository.getById(plateId);
    if (!plate || plate.chatId !== chatId) throw new CarPlateNotFoundError();
    return plate;
  }

  public async updatePlate(plateId: string, chatId: number, dto: CreateCarPlateDto): Promise<void> {
    await this.findOwnedPlate(plateId, chatId);

    try {
      await this.repository.update(
        plateId,
        {
          plate: dto.plate,
          name: dto.name,
          updatedAt: new Date(),
        },
        chatId,
      );
    } catch (error) {
      throw this.wrapDuplicate(error);
    }
  }

  public async deletePlate(plateId: string, chatId: number): Promise<void> {
    await this.findOwnedPlate(plateId, chatId);
    await this.repository.delete(plateId, chatId);
  }

  private wrapDuplicate(error: unknown): unknown {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY_ERROR_CODE) {
      return new DuplicatePlateError();
    }
    return error;
  }
}
