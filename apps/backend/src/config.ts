import { z } from 'zod';
import {
  DEFAULT_MAX_ACCURACY_M,
  DEFAULT_MAX_LOCATION_AGE_S,
} from '@rheinraum/shared';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL fehlt'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen lang sein'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('./storage/photos'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  LOCATION_MAX_ACCURACY_M: z.coerce.number().positive().default(DEFAULT_MAX_ACCURACY_M),
  LOCATION_MAX_AGE_S: z.coerce.number().positive().default(DEFAULT_MAX_LOCATION_AGE_S),
  ROUTING_PROVIDER: z.enum(['simulated', 'osrm']).default('simulated'),
  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
  LOG_LEVEL: z.string().default('info'),
  /** Optional: gebaute Admin-Weboberfläche (apps/admin/dist) unter derselben Adresse ausliefern. */
  ADMIN_DIST_DIR: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration (siehe apps/backend/.env.example):\n${issues}`);
  }
  return parsed.data;
}
