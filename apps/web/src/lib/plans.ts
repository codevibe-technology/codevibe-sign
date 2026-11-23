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

/** Where the plans are compared, for someone who is not in a workspace. */
export const PRICING_PATH = '/#pricing';

/** The page where a workspace changes its plan. */
export const planPagePath = (slug: string) => `/dashboard/${slug}/settings/plan`;

/** What a plan allows. `null` means no limit. */
export interface PlanLimits {
  /** Envelopes sent per calendar month (UTC), bulk-sent ones included. */
  envelopesPerMonth: number | null;
  /** Members plus open invitations. On Cloud, extra members a workspace pays for are added. */
  members: number | null;
  /** Templates that are not archived. */
  activeTemplates: number | null;
  /** Webhook endpoints that receive events. Zero means webhooks are not part of the plan. */
  webhooks: number | null;
  /** Rows in one bulk send. */
  bulkRows: number | null;
  /** Requests made with an API key, per calendar month in India time. */
  apiRequestsPerMonth: number | null;
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
  /** Aadhaar eSign through the workspace's own eSign provider account. */
  ownEsignAccount: boolean;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Members a Cloud workspace has before it pays for more, unless the operator sets another. */
export const CLOUD_INCLUDED_MEMBERS = 25;

export const FREE_PLAN_LIMITS: PlanLimits = {
  envelopesPerMonth: 10,
  members: 2,
  activeTemplates: 2,
  webhooks: 0,
  bulkRows: 10,
  apiRequestsPerMonth: 100,
  apiRequestsPerDay: null,
  fileBytes: 10 * MB,
  envelopeBytes: 25 * MB,
  storageBytes: 200 * MB,
  ownedWorkspaces: 1,
  customDomain: false,
  badgeRequired: true,
  ownEsignAccount: false,
};

/**
 * Cloud has no plan numbers for envelopes, templates, bulk sends or API calls. The numbers
 * left here are fair-use caps that keep one workspace from starving the others; they are
 * listed in `CLOUD_FAIR_USE`.
 */
export const CLOUD_PLAN_LIMITS: PlanLimits = {
  envelopesPerMonth: null,
  members: CLOUD_INCLUDED_MEMBERS,
  activeTemplates: null,
  webhooks: 10,
  bulkRows: 500,
  apiRequestsPerMonth: null,
  apiRequestsPerDay: 10_000,
  fileBytes: 25 * MB,
  envelopeBytes: 100 * MB,
  storageBytes: 20 * GB,
  ownedWorkspaces: null,
  customDomain: true,
  badgeRequired: false,
  ownEsignAccount: true,
};

export const UNLIMITED_LIMITS: PlanLimits = {
  envelopesPerMonth: null,
  members: null,
  activeTemplates: null,
  webhooks: null,
  bulkRows: null,
  apiRequestsPerMonth: null,
  apiRequestsPerDay: null,
  fileBytes: null,
  envelopeBytes: null,
  storageBytes: null,
  ownedWorkspaces: null,
  customDomain: true,
  badgeRequired: false,
  ownEsignAccount: true,
};

export type FeatureLimit = 'customDomain' | 'badgeRequired' | 'ownEsignAccount';
export type CountedLimit = Exclude<keyof PlanLimits, FeatureLimit>;

/** The Cloud numbers that are fair-use caps rather than something the plan sells. */
export const CLOUD_FAIR_USE: readonly CountedLimit[] = [
  'webhooks',
  'bulkRows',
  'apiRequestsPerDay',
  'fileBytes',
  'envelopeBytes',
  'storageBytes',
];

const count = z.number().int().min(0).nullable();
const overridesSchema = z
  .object({
    envelopesPerMonth: count,
    members: count,
    activeTemplates: count,
    webhooks: count,
    bulkRows: count,
    apiRequestsPerMonth: count,
    apiRequestsPerDay: count,
    fileBytes: count,
    envelopeBytes: count,
    storageBytes: count,
    ownedWorkspaces: count,
    customDomain: z.boolean(),
    badgeRequired: z.boolean(),
    ownEsignAccount: z.boolean(),
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
  /** Members included in Cloud, from the operator's settings. Default `CLOUD_INCLUDED_MEMBERS`. */
  cloudIncludedMembers?: number;
}

/**
 * The limits a workspace on `plan` works within. Self-hosted installs have none. `extraSeats`
 * are the members a Cloud workspace pays for on top of the included ones.
 */
export function limitsFor(plan: Plan, settings: PlanSettings, extraSeats = 0): PlanLimits {
  if (settings.mode === 'self-hosted') return UNLIMITED_LIMITS;
  if (plan === 'free') return { ...FREE_PLAN_LIMITS, ...settings.freeOverrides };
  if (plan === 'cloud') {
    const included = settings.cloudIncludedMembers ?? CLOUD_INCLUDED_MEMBERS;
    const seats = Number.isInteger(extraSeats) && extraSeats > 0 ? extraSeats : 0;
    return { ...CLOUD_PLAN_LIMITS, members: included + seats };
  }
  return UNLIMITED_LIMITS;
}

/** Billing, prices and plan pages exist only on the hosted cloud. */
export const billingVisible = (settings: PlanSettings) => settings.mode === 'hosted';

/** `ist-month` is the calendar month in India time (UTC+5:30), which has no daylight saving. */
export type Period = 'month' | 'day' | 'ist-month' | 'total';

const IST_OFFSET_MS = 330 * 60_000;

/** The counter a usage falls in: `2026-11`, `2026-11-20` or `total`. UTC unless the period says IST. */
export function periodKey(period: Period, now: Date): string {
  if (period === 'ist-month')
    return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
  const iso = now.toISOString();
  if (period === 'month') return iso.slice(0, 7);
  if (period === 'day') return iso.slice(0, 10);
  return 'total';
}

/** When a monthly or daily count starts again; null for totals. */
export function resetsAt(period: Period, now: Date): Date | null {
  if (period === 'ist-month') {
    const local = new Date(now.getTime() + IST_OFFSET_MS);
    const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
    return new Date(next - IST_OFFSET_MS);
  }
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

const day = (date: Date, timeZone: string) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone });

/** `1 December 2026 (UTC)`: usage periods turn over at midnight UTC, so the day is UTC's. */
export const formatDay = (date: Date) => `${day(date, 'UTC')} (UTC)`;

/** The day a count starts again, in the zone its period follows. */
export const formatReset = (period: Period, date: Date) =>
  period === 'ist-month' ? `${day(date, 'Asia/Kolkata')} (IST)` : formatDay(date);

/** What to write after a limit message: where to get more, depending on the plan. */
export const upgradeHint = (plan: Plan) =>
  plan === 'free'
    ? 'Upgrade to Cloud on the Plan and usage page.'
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
  {
    key: 'apiRequestsPerMonth',
    label: 'API requests this month',
    unit: 'count',
    period: 'ist-month',
  },
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

/** One row of the plan comparison: the same feature on Free, Cloud and a self-hosted install. */
export interface PlanFeature {
  key: CountedLimit | FeatureLimit | 'aadhaarEsign';
  label: string;
  free: string;
  cloud: string;
  selfHosted: string;
}

const NO_LIMIT = 'Unlimited';
const amount = (value: number | null, unit: string, many = `${unit}s`) =>
  value === null ? NO_LIMIT : `${value.toLocaleString('en-IN')} ${value === 1 ? unit : many}`;
const bytes = (value: number | null) => (value === null ? NO_LIMIT : formatBytes(value));

/**
 * The plan comparison as text, built from the limits and nothing else. The pricing section,
 * the Plan and usage page and the docs table all show these rows, so a number is written in
 * one place. Prices are not here; they come from the operator's settings.
 */
export function planFeatures(settings: PlanSettings): PlanFeature[] {
  const hosted: PlanSettings = { ...settings, mode: 'hosted' };
  const free = limitsFor('free', hosted);
  const cloud = limitsFor('cloud', hosted);
  const fair = (text: string) => `${text} (fair use)`;
  return [
    {
      key: 'envelopesPerMonth',
      label: 'Envelopes sent',
      free: `${amount(free.envelopesPerMonth, 'envelope')} a month`,
      cloud: amount(cloud.envelopesPerMonth, 'envelope'),
      selfHosted: NO_LIMIT,
    },
    {
      key: 'members',
      label: 'Members',
      free: amount(free.members, 'member'),
      cloud: `${amount(cloud.members, 'member')} included, more can be added`,
      selfHosted: NO_LIMIT,
    },
    {
      key: 'activeTemplates',
      label: 'Active templates',
      free: amount(free.activeTemplates, 'template'),
      cloud: amount(cloud.activeTemplates, 'template'),
      selfHosted: NO_LIMIT,
    },
    {
      key: 'bulkRows',
      label: 'Bulk send',
      free: `Up to ${amount(free.bulkRows, 'row')} in one send`,
      cloud: fair(`Up to ${amount(cloud.bulkRows, 'row')} in one send`),
      selfHosted: NO_LIMIT,
    },
    {
      key: 'apiRequestsPerMonth',
      label: 'API requests',
      free: `${amount(free.apiRequestsPerMonth, 'request')} a month`,
      cloud:
        cloud.apiRequestsPerDay === null
          ? NO_LIMIT
          : fair(`${NO_LIMIT}, up to ${amount(cloud.apiRequestsPerDay, 'request')} a day`),
      selfHosted: NO_LIMIT,
    },
    {
      key: 'webhooks',
      label: 'Webhooks',
      free: free.webhooks === 0 ? 'Not included' : amount(free.webhooks, 'endpoint'),
      cloud:
        cloud.webhooks === null ? 'Included' : fair(`Up to ${amount(cloud.webhooks, 'endpoint')}`),
      selfHosted: 'Included',
    },
    {
      key: 'fileBytes',
      label: 'PDF size',
      free: `${bytes(free.fileBytes)} a file, ${bytes(free.envelopeBytes)} an envelope`,
      cloud: `${bytes(cloud.fileBytes)} a file, ${bytes(cloud.envelopeBytes)} an envelope`,
      selfHosted: 'Set by you',
    },
    {
      key: 'storageBytes',
      label: 'Stored documents',
      free: bytes(free.storageBytes),
      cloud: cloud.storageBytes === null ? NO_LIMIT : fair(bytes(cloud.storageBytes)),
      selfHosted: 'Your own disk',
    },
    {
      key: 'customDomain',
      label: 'Your own signing domain',
      free: free.customDomain ? 'Included' : 'Not included',
      cloud: cloud.customDomain ? 'Included' : 'Not included',
      selfHosted: 'Included',
    },
    {
      key: 'badgeRequired',
      label: '"Secured by Codevibe Sign" badge',
      free: free.badgeRequired ? 'Always shown' : 'Optional',
      cloud: cloud.badgeRequired ? 'Always shown' : 'Optional',
      selfHosted: 'Optional',
    },
    {
      key: 'aadhaarEsign',
      label: 'Aadhaar eSign',
      free: 'Pay per eSign with prepaid credits',
      cloud: 'Pay per eSign with prepaid credits, at a lower price',
      selfHosted: 'With your own eSign provider account',
    },
    {
      key: 'ownEsignAccount',
      label: 'Connect your own eSign provider account',
      free: free.ownEsignAccount ? 'Included' : 'Not included',
      cloud: cloud.ownEsignAccount ? 'Included' : 'Not included',
      selfHosted: 'Included',
    },
  ];
}

/** The comparison as a Markdown table, the exact text the README and the docs carry. */
export function planTableMarkdown(settings: PlanSettings): string {
  const rows = planFeatures(settings).map(
    (row) => `| ${row.label} | ${row.free} | ${row.cloud} | ${row.selfHosted} |`,
  );
  return ['|  | Free | Cloud | Self-hosted |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

/** Docs put the table between these two comments; a test keeps it equal to `planTableMarkdown`. */
export const PLAN_TABLE_START = '<!-- plans:start -->';
export const PLAN_TABLE_END = '<!-- plans:end -->';

/** The period each counted limit runs over; limits not listed are totals. */
export const LIMIT_PERIODS: Partial<Record<CountedLimit, Period>> = {
  envelopesPerMonth: 'month',
  apiRequestsPerMonth: 'ist-month',
  apiRequestsPerDay: 'day',
};
