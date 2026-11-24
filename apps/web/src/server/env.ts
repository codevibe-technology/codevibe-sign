import 'server-only';
import { z } from 'zod';
import { isTimeZone } from '@/lib/preferences';
import {
  DEFAULT_IDLE_MINUTES,
  DEFAULT_MAX_HOURS,
  MAX_IDLE_MINUTES,
  MAX_SESSION_HOURS,
  sessionPolicy,
} from '@/lib/session-policy';
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
  SEAL_TSA_URL: z
    .url({
      protocol: /^https?$/,
      error:
        'SEAL_TSA_URL must be an http:// or https:// URL, for example http://timestamp.digicert.com',
    })
    .optional(),
  /** Unset means "required when SEAL_TSA_URL is set". */
  SEAL_TSA_REQUIRED: z
    .enum(['true', 'false', '1', '0'], { error: 'SEAL_TSA_REQUIRED must be true or false' })
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true' || value === '1')),
  SIGN_SESSION_SECRET: z.string().min(32).optional(),
  SIGN_TIME_ZONE: z
    .string()
    .refine(isTimeZone, 'SIGN_TIME_ZONE must be an IANA time zone, for example Asia/Kolkata')
    .optional(),
  SINGLE_WORKSPACE: flag,
  AUTO_MIGRATE: flag,
  TRUST_PROXY: flag,
  WEBHOOK_ALLOW_INSECURE: flag,
  SIGN_TICK_SECONDS: z.coerce.number().int().min(0).default(60),
  SESSION_IDLE_MINUTES: z.coerce
    .number({
      error: 'SESSION_IDLE_MINUTES must be a whole number of minutes, or 0 to turn it off',
    })
    .int('SESSION_IDLE_MINUTES must be a whole number of minutes, or 0 to turn it off')
    .min(0, 'SESSION_IDLE_MINUTES must be 0 (off) or more')
    .max(MAX_IDLE_MINUTES, `SESSION_IDLE_MINUTES must be at most ${MAX_IDLE_MINUTES} (a day)`)
    .default(DEFAULT_IDLE_MINUTES),
  SESSION_MAX_HOURS: z.coerce
    .number({ error: 'SESSION_MAX_HOURS must be a whole number of hours' })
    .int('SESSION_MAX_HOURS must be a whole number of hours')
    .min(1, 'SESSION_MAX_HOURS must be at least 1')
    .max(MAX_SESSION_HOURS, `SESSION_MAX_HOURS must be at most ${MAX_SESSION_HOURS} (30 days)`)
    .default(DEFAULT_MAX_HOURS),
  TURNSTILE_SITE_KEY: z.string().max(200).optional(),
  TURNSTILE_SECRET_KEY: z.string().max(200).optional(),
});

const GRAPH_VARS = ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET'] as const;
const MAILBOX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const checked = schema.superRefine((config, ctx) => {
  if (Boolean(config.TURNSTILE_SITE_KEY) !== Boolean(config.TURNSTILE_SECRET_KEY)) {
    const [set, missing] = config.TURNSTILE_SITE_KEY
      ? ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']
      : ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'];
    ctx.addIssue({
      code: 'custom',
      path: [missing],
      message: `${missing} is required when ${set} is set; set both or neither (see deploy/README.md, "Bot protection")`,
    });
  }
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

/** The zone for workspaces that have not chosen one: `SIGN_TIME_ZONE`, or UTC. */
export const defaultTimeZone = (config: Env) => config.SIGN_TIME_ZONE ?? 'UTC';

/** Idle sign-out and the lifetime cap of app sessions, from `SESSION_*`. */
export const appSessionPolicy = (config: Env) =>
  sessionPolicy({ idleMinutes: config.SESSION_IDLE_MINUTES, maxHours: config.SESSION_MAX_HOURS });

export const googleEnabled = (config: Env) =>
  Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
