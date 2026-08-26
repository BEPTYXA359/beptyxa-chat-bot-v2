import { z } from 'zod';
import { ObjectId } from 'mongodb';

// На клавиатуре с латинской раскладкой буквы номера вводятся двойниками — приводим их к кириллице
const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А',
  B: 'В',
  E: 'Е',
  K: 'К',
  M: 'М',
  H: 'Н',
  O: 'О',
  P: 'Р',
  C: 'С',
  T: 'Т',
  Y: 'У',
  X: 'Х',
};

export const RU_PLATE_LETTERS = 'АВЕКМНОРСТУХ';
export const RU_PLATE_REGEX = new RegExp(
  `^[${RU_PLATE_LETTERS}]\\d{3}[${RU_PLATE_LETTERS}]{2}\\d{2,3}$`,
);

export const normalizePlate = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[\s.-]/g, '')
    .replace(/[ABEKMHOPTCYX]/g, (char) => LATIN_TO_CYRILLIC[char] ?? char);

export const createCarPlateSchema = z.object({
  plate: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform(normalizePlate)
    .pipe(z.string().regex(RU_PLATE_REGEX, 'plate must match russian format: А123ВС77')),
  name: z.string().trim().min(1).max(100),
});

export type CreateCarPlateDto = z.infer<typeof createCarPlateSchema>;

export type CarPlateFormat = 'ru';

export interface CarPlateDocument {
  _id?: ObjectId;
  chatId: number;
  plate: string;
  name: string;
  format: CarPlateFormat;
  createdAt: Date;
  updatedAt?: Date;
  createdBy: number;
  creatorFirstName: string;
  creatorUsername?: string;
}
