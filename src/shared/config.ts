import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  EXCHANGE_APP_ID: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  MONGO_URI: z.string().min(1),
  MONGO_DB_NAME: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(32),
  GROQ_API_KEY: z.string().min(1),
  GROQ_MODEL: z.string().min(1),
});

export const config = configSchema.parse(process.env);
