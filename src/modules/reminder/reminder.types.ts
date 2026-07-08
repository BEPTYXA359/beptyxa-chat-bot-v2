import { z } from 'zod';
import { ObjectId } from 'mongodb';

export const FrequencyType = z.enum(['once', 'daily', 'every_other_day', 'specific_days']);
export type FrequencyType = z.infer<typeof FrequencyType>;

export const createReminderSchema = z.object({
  time: z.string(),
  frequency: FrequencyType,
  specificDays: z.array(z.number().min(0).max(6)).optional(),
  message: z.string().min(1).max(1000),
});

export type CreateReminderDto = z.infer<typeof createReminderSchema>;

export interface ReminderDocument {
  _id?: ObjectId;
  chatId: number;
  message: string;
  frequency: FrequencyType;
  time: string;
  specificDays?: number[];
  agendaJobId?: string;
  createdAt: Date;
  createdBy: number;
  creatorFirstName: string;
  creatorUsername?: string;
}
