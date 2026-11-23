import { z } from 'zod';

export const PLANS = ['free', 'cloud', 'unlimited'] as const;
export type Plan = (typeof PLANS)[number];

export const isPlan = (value: unknown): value is Plan =>
  typeof value === 'string' && (PLANS as readonly string[]).includes(value);

export const PLAN_NAMES: Record<Plan, string> = {
  free: 'Free',
  cloud: 'Cloud',
  unlimited: 'Unlimited',
};

/**
 * `self-hosted`: every workspace is unlimited and no limits are shown. `hosted`: the Codevibe
 * cloud, where new workspaces start on the Free plan.
 */
export const PLAN_MODES = ['self-hosted', 'hosted'] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export const UPGRADE_EMAIL = 'hello@codevibe.in';

/** What a plan allows. `null` means no limit. */
export interface PlanLimits {
  /** Envelopes sent per calendar month (UTC), bulk-sent ones included. */
  envelopesPerMonth: number | null;
  /** Members plus open invitations. */
  members: number | null;
  /** Templates that are not archived. */
  activeTemplates: number | null;
  webhooks: number | null;
  /** Rows in one bulk send. */
  bulkRows: number | null;
  /** Requests made with an API key, per day (UTC). */
  apiRequestsPerDay: number | null;
  /** One uploaded PDF. */
  fileBytes: number | null;
  /** All the PDFs of one envelope. */
  envelopeBytes: number | null;
  /** Every document uploaded to the workspace, for envelopes and templates. */
  storageBytes: number | null;
  /** Workspaces on this plan one person may own. */
  ownedWorkspaces: number | null;
  customDomain: boolean;
  /** The "Secured by Codevibe Sign" badge cannot be turned off. */
  badgeRequired: boolean;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const FREE_PLAN_LIMITS: PlanLimits = {
  envelopesPerMonth: 10,
  members: 3,
  activeTemplates: 5,
  webhooks: 1,
  bulkRows: 25,
  apiRequestsPerDay: 100,
  fileBytes: 10 * MB,
  envelopeBytes: 25 * MB,
  storageBytes: 200 * MB,
  ownedWorkspaces: 1,
  customDomain: false,
  badgeRequired: true,
};

export const CLOUD_PLAN_LIMITS: PlanLimits = {
  envelopesPerMonth: 500,
  members: 25,
  activeTemplates: null,
  webhooks: 10,
  bulkRows: 500,
  apiRequestsPerDay: 10_000,
  fileBytes: 25 * MB,
  envelopeBytes: 100 * MB,
  storageBytes: 20 * GB,
  ownedWorkspaces: null,
  customDomain: true,
  badgeRequired: false,
};

export const UNLIMITED_LIMITS: PlanLimits = {
  envelopesPerMonth: null,
  members: null,
  activeTemplates: null,
  webhooks: null,
  bulkRows: null,
  apiRequestsPerDay: null,
  fileBytes: null,
  envelopeBytes: null,
  storageBytes: null,
  ownedWorkspaces: null,
  customDomain: true,
  badgeRequired: false,
};

export type CountedLimit = Exclude<keyof PlanLimits, 'customDomain' | 'badgeRequired'>;

const count = z.number().int().min(0).nullable();
const overridesSchema = z
  .object({
    envelopesPerMonth: count,
    members: count,
    activeTemplates: count,
    webhooks: count,
    bulkRows: count,
    apiRequestsPerDay: count,
    fileBytes: count,
    envelopeBytes: count,
    storageBytes: count,
    ownedWorkspaces: count,
    customDomain: z.boolean(),
    badgeRequired: z.boolean(),
  })
  .partial()
  .strict();

/**
 * Reads `FREE_PLAN_LIMITS`, a JSON object with any of the `PlanLimits` keys, for example
 * `{"envelopesPerMonth":20}`. Throws a message naming the variable and the bad key.
 */
export function parseLimitOverrides(raw: string | undefined): Partial<PlanLimits> {
  if (!raw?.trim()) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('FREE_PLAN_LIMITS must be a JSON object, for example {"envelopesPerMonth":20}');
  }
  const parsed = overridesSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.path.join('.') || (issue && 'keys' in issue ? String(issue.keys) : '');
    throw new Error(`FREE_PLAN_LIMITS: ${key ? `${key}: ` : ''}${issue?.message ?? 'is invalid'}`);
  }
  return parsed.data as Partial<PlanLimits>;
}

export interface PlanSettings {
  mode: PlanMode;
  freeOverrides: Partial<PlanLimits>;
}

/** The limits a workspace on `plan` works within. Self-hosted installs have none. */
export function limitsFor(plan: Plan, settings: PlanSettings): PlanLimits {
  if (settings.mode === 'self-hosted') return UNLIMITED_LIMITS;
  if (plan === 'free') return { ...FREE_PLAN_LIMITS, ...settings.freeOverrides };
  if (plan === 'cloud') return CLOUD_PLAN_LIMITS;
  return UNLIMITED_LIMITS;
}

export type Period = 'month' | 'day' | 'total';

/** The counter a usage falls in: `2026-11`, `2026-11-20` or `total`. Always UTC. */
export function periodKey(period: Period, now: Date): string {
  const iso = now.toISOString();
  if (period === 'month') return iso.slice(0, 7);
  if (period === 'day') return iso.slice(0, 10);
  return 'total';
}

/** When a monthly or daily count starts again; null for totals. */
export function resetsAt(period: Period, now: Date): Date | null {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === 'month') return new Date(Date.UTC(y, m + 1, 1));
  if (period === 'day') return new Date(Date.UTC(y, m, now.getUTCDate() + 1));
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${trim(bytes / GB)} GB`;
  if (bytes >= MB) return `${trim(bytes / MB)} MB`;
  if (bytes >= 1024) return `${trim(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

/** `1 December 2026 (UTC)`: usage periods turn over at midnight UTC, so the day is UTC's. */
export const formatDay = (date: Date) =>
  `${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })} (UTC)`;

/** What to write after a limit message: who to ask, depending on the plan. */
export const upgradeHint = (plan: Plan) =>
  plan === 'free'
    ? `Upgrade to Cloud: write to ${UPGRADE_EMAIL}.`
    : `To raise it, write to ${UPGRADE_EMAIL}.`;

export interface Meter {
  key: CountedLimit;
  label: string;
  unit: 'count' | 'bytes';
  period: Period;
}

/** The limits that have a running count, as the Plan and usage page shows them. */
export const METERS: readonly Meter[] = [
  { key: 'envelopesPerMonth', label: 'Envelopes sent this month', unit: 'count', period: 'month' },
  { key: 'members', label: 'Members and open invitations', unit: 'count', period: 'total' },
  { key: 'activeTemplates', label: 'Active templates', unit: 'count', period: 'total' },
  { key: 'webhooks', label: 'Webhook endpoints', unit: 'count', period: 'total' },
  { key: 'apiRequestsPerDay', label: 'API requests today', unit: 'count', period: 'day' },
  { key: 'storageBytes', label: 'Stored documents', unit: 'bytes', period: 'total' },
];

/** Limits that apply to each send or upload rather than adding up. */
export const PER_USE_LIMITS: readonly { key: CountedLimit; label: string; unit: Meter['unit'] }[] =
  [
    { key: 'bulkRows', label: 'Rows in one bulk send', unit: 'count' },
    { key: 'fileBytes', label: 'One PDF', unit: 'bytes' },
    { key: 'envelopeBytes', label: 'All PDFs in one envelope', unit: 'bytes' },
  ];

export const formatAmount = (value: number, unit: Meter['unit']) =>
  unit === 'bytes' ? formatBytes(value) : value.toLocaleString('en-IN');
