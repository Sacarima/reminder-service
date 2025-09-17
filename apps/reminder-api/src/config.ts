import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SERVICE_TOKEN_DEV: z.string().min(1),
  QUIET_HOURS_START: z.string().regex(/^\d{2}:\d{2}$/).default('10:00'),
  QUIET_HOURS_END:   z.string().regex(/^\d{2}:\d{2}$/).default('19:00'),
});

export const env = EnvSchema.parse(process.env);
