import { z } from 'zod';
import { ObjectId } from 'mongodb';

export const FrequencyType = z.enum(['once', 'daily', 'every_other_day', 'specific_days']);
export type FrequencyType = z.infer<typeof FrequencyType>;

export const createReminderSchema = z
  .object({
    time: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'time must be a valid ISO datetime',
    }),
    frequency: FrequencyType,
    specificDays: z.array(z.number().int().min(0).max(6)).optional(),
    message: z.string().min(1).max(1000),
    timezone: z
      .string()
      .refine((tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone')
      .default('UTC'),
    silent: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (
      data.frequency === 'specific_days' &&
      (!data.specificDays || data.specificDays.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'specificDays must be a non-empty array for specific_days frequency',
        path: ['specificDays'],
      });
    }

    if (data.frequency === 'once') {
      const runAt = new Date(data.time);
      if (!Number.isNaN(runAt.getTime()) && runAt.getTime() <= Date.now()) {
        ctx.addIssue({
          code: 'custom',
          message: 'time for a one-time reminder must be in the future',
          path: ['time'],
        });
      }
    }
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
  timezone?: string;
  silent?: boolean;
  createdAt: Date;
  createdBy: number;
  creatorFirstName: string;
  creatorUsername?: string;
  lastFiredAt?: Date;
}
