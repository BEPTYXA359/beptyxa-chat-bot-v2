import { z } from 'zod';
import { ObjectId } from 'mongodb';

export const FrequencyType = z.enum(['once', 'daily', 'every_other_day', 'specific_days']);
export type FrequencyType = z.infer<typeof FrequencyType>;

export const createReminderSchema = z
  .object({
    time: z.string(),
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
      if (Number.isNaN(runAt.getTime())) {
        ctx.addIssue({
          code: 'custom',
          message: 'time must be a valid ISO datetime for once frequency',
          path: ['time'],
        });
      } else if (runAt.getTime() <= Date.now()) {
        ctx.addIssue({
          code: 'custom',
          message: 'time for a one-time reminder must be in the future',
          path: ['time'],
        });
      }
    } else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(data.time)) {
      ctx.addIssue({
        code: 'custom',
        message: 'time must be in HH:MM format for recurring reminders',
        path: ['time'],
      });
    }
  });

export type CreateReminderDto = z.infer<typeof createReminderSchema>;

export type ReminderKind = 'regular' | 'steam_release';

export interface SteamSubscriber {
  id: number;
  firstName: string;
  username?: string;
}

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
  kind?: ReminderKind;
  steamAppId?: string;
  gameName?: string;
  subscribers?: SteamSubscriber[];
  createdAt: Date;
  createdBy: number;
  creatorFirstName: string;
  creatorUsername?: string;
  lastFiredAt?: Date;
}
