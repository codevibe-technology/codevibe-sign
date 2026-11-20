import 'server-only';
import { z } from 'zod';

const flag = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required, for example postgres://...'),
  APP_URL: z
    .url('APP_URL must be the public URL of the app, for example https://sign.example.com')
    .default('http://localhost:3000')
    .transform((url) => url.replace(/\/+$/, '')),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MAIL_TRANSPORT: z.string().default('console'),
  MAIL_FROM: z.string().default('Codevibe Sign <sign@localhost>'),
  FILES_DIR: z.string().default('./data/files'),
  SEAL_P12_PATH: z.string().optional(),
  SEAL_PASSPHRASE: z.string().default(''),
  SEAL_ALLOW_WEAK_KEY: flag,
  SIGN_SESSION_SECRET: z.string().min(32).optional(),
  SINGLE_WORKSPACE: flag,
  AUTO_MIGRATE: flag,
  TRUST_PROXY: flag,
  WEBHOOK_ALLOW_INSECURE: flag,
  SIGN_TICK_SECONDS: z.coerce.number().int().min(0).default(60),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * The app's configuration, read once. Missing or malformed values stop the request with a
 * message naming the variable, so a misconfigured install says what to fix.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  cached = parsed.data;
  return cached;
}

export const googleEnabled = (config: Env) =>
  Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
