import 'server-only';
import { z } from 'zod';
import { parseMailbox } from './graph-mail';

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
  MS_TENANT_ID: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
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

const GRAPH_VARS = ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET'] as const;
const MAILBOX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const checked = schema.superRefine((config, ctx) => {
  if (config.MAIL_TRANSPORT !== 'graph') return;
  for (const name of GRAPH_VARS) {
    if (!config[name]) {
      ctx.addIssue({
        code: 'custom',
        path: [name],
        message: `${name} is required when MAIL_TRANSPORT=graph (see deploy/README.md, "Microsoft 365")`,
      });
    }
  }
  if (!MAILBOX.test(parseMailbox(config.MAIL_FROM).address)) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_FROM'],
      message:
        'MAIL_FROM must name the Microsoft 365 mailbox to send from when MAIL_TRANSPORT=graph, ' +
        'for example Your Company <no-reply@example.com>',
    });
  }
});

export type Env = z.infer<typeof schema>;

/**
 * Checks a set of environment variables. Each problem names its variable, so a misconfigured
 * install says what to fix. A blank value (`GOOGLE_CLIENT_ID=`) means "not set".
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = checked.safeParse(set);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/**
 * The app's configuration, read once. Missing or malformed values stop the request with a
 * message naming the variable, so a misconfigured install says what to fix.
 */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export const googleEnabled = (config: Env) =>
  Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
