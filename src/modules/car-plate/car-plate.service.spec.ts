import { describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { CarPlateRepository } from './car-plate.repository';
import type { CarPlateDocument } from './car-plate.types';
import { CarPlateService } from './car-plate.service';

function plate(chatId: number): CarPlateDocument {
  return {
    _id: new ObjectId(),
    chatId,
    plate: 'А123ВС77',
    name: 'Test',
    format: 'ru',
    createdAt: new Date(),
    createdBy: 111,
    creatorFirstName: 'Test',
  };
}

describe('владение автомобильными номерами', () => {
  it('не удаляет номер другого чата', async () => {
    const repository = {
      getById: vi.fn().mockResolvedValue(plate(-100)),
      delete: vi.fn(),
    };
    const service = new CarPlateService(repository as unknown as CarPlateRepository);
    const id = new ObjectId().toString();

    await expect(service.deletePlate(id, -200)).rejects.toThrow('Номер не найден');
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('передаёт chatId в scoped-удаление собственного номера', async () => {
    const repository = {
      getById: vi.fn().mockResolvedValue(plate(-100)),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new CarPlateService(repository as unknown as CarPlateRepository);
    const id = new ObjectId().toString();

    await service.deletePlate(id, -100);

    expect(repository.delete).toHaveBeenCalledWith(id, -100);
  });
});
