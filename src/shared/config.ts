import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
    BOT_TOKEN: z.string().min(1),
    NODE_ENV: z.enum(['development', 'production']).default('development'),
});

export const config = configSchema.parse(process.env);