import 'server-only';
import type postgres from 'postgres';
import {
  METERS,
  PLAN_MODES,
  PLAN_NAMES,
  formatAmount,
  formatBytes,
  formatDay,
  isPlan,
  limitsFor,
  parseLimitOverrides,
  periodKey,
  resetsAt,
  upgradeHint,
  type CountedLimit,
  type Period,
  type Plan,
  type PlanLimits,
  type PlanMode,
  type PlanSettings,
} from '@/lib/plans';
import { AppError } from './errors';

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * A plan limit was reached. The message names the limit, the usage and what to do, and the
 * fields let the API answer with the numbers too.
 */
export class PlanLimitError extends AppError {
  readonly limit: CountedLimit | 'customDomain' | 'badgeRequired';
  readonly used: number | null;
  readonly max: number | null;
  readonly plan: Plan;
  readonly resetsAt: Date | null;

  constructor(input: {
    limit: PlanLimitError['limit'];
    used?: number | null;
    max?: number | null;
    plan: Plan;
    message: string;
    field?: string;
    resetsAt?: Date | null;
  }) {
    super('PLAN_LIMIT', input.message, input.field);
    this.name = 'PlanLimitError';
    this.limit = input.limit;
    this.used = input.used ?? null;
    this.max = input.max ?? null;
    this.plan = input.plan;
    this.resetsAt = input.resetsAt ?? null;
  }

  /** The body the API answers with, next to status 403. */
  toJSON() {
    return {
      error: {
        code: 'PLAN_LIMIT',
        message: this.message,
        details: {
          limit: this.limit,
          used: this.used,
          max: this.max,
          plan: this.plan,
          ...(this.resetsAt ? { resetsAt: this.resetsAt.toISOString() } : {}),
        },
      },
    };
  }
}

/** `PLAN_MODE` and `FREE_PLAN_LIMITS`, read from the environment on every call. */
export function planSettings(source: NodeJS.ProcessEnv = process.env): PlanSettings {
  const mode = (source.PLAN_MODE?.trim() || 'self-hosted') as PlanMode;
  if (!PLAN_MODES.includes(mode)) {
    throw new Error(`PLAN_MODE must be "self-hosted" or "hosted", not "${source.PLAN_MODE}"`);
  }
  return { mode, freeOverrides: parseLimitOverrides(source.FREE_PLAN_LIMITS) };
}

export const isHosted = (settings: PlanSettings = planSettings()) => settings.mode === 'hosted';

/** The plan a new workspace starts on. */
export const startingPlan = (settings: PlanSettings = planSettings()): Plan =>
  settings.mode === 'hosted' ? 'free' : 'unlimited';

export interface WorkspacePlan {
  plan: Plan;
  limits: PlanLimits;
}

async function readPlan(sql: Sql, workspaceId: string, lock: boolean): Promise<Plan> {
  const [row] = await sql<{ plan: string }[]>`
    select plan from app_workspaces where id = ${workspaceId} ${lock ? sql`for update` : sql``}`;
  if (!row) throw new AppError('NOT_FOUND', 'Workspace not found');
  return isPlan(row.plan) ? row.plan : 'free';
}

export async function workspacePlan(
  sql: Sql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
): Promise<WorkspacePlan> {
  if (settings.mode === 'self-hosted')
    return { plan: 'unlimited', limits: limitsFor('unlimited', settings) };
  const plan = await readPlan(sql, workspaceId, false);
  return { plan, limits: limitsFor(plan, settings) };
}

/**
 * The workspace's plan, read with its row locked for the rest of the transaction. Adding a
 * member, template or webhook counts and inserts under this lock, so two requests at once
 * cannot both take the last place.
 */
export async function lockedPlan(
  tx: postgres.TransactionSql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
): Promise<WorkspacePlan | null> {
  if (settings.mode === 'self-hosted') return null;
  const plan = await readPlan(tx, workspaceId, true);
  return { plan, limits: limitsFor(plan, settings) };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

function countMessage(key: CountedLimit, used: number, max: number, plan: Plan, now: Date): string {
  const name = PLAN_NAMES[plan];
  const hint = upgradeHint(plan);
  switch (key) {
    case 'envelopesPerMonth':
      return `This workspace has sent ${used} of the ${plural(max, 'envelope')} the ${name} plan allows each month. ${hint} The count starts again on ${formatDay(resetsAt('month', now)!)}.`;
    case 'members':
      return `This workspace has ${plural(used, 'member')} and open invitations, and the ${name} plan allows ${max}. Remove someone or cancel an invitation, or ${lower(hint)}`;
    case 'activeTemplates':
      return `This workspace has ${plural(used, 'active template')}, and the ${name} plan allows ${max}. Archive a template you no longer use, or ${lower(hint)}`;
    case 'webhooks':
      return `This workspace has ${plural(used, 'webhook endpoint')}, and the ${name} plan allows ${max}. Remove one first, or ${lower(hint)}`;
    case 'bulkRows':
      return `This file has ${plural(used, 'row')}, and the ${name} plan sends up to ${max} in one bulk send. Split it into files of ${max} rows, or ${lower(hint)}`;
    case 'apiRequestsPerDay':
      return `This workspace has made ${used} of the ${plural(max, 'API request')} the ${name} plan allows each day. Try again after 00:00 UTC, or ${lower(hint)}`;
    case 'fileBytes':
      return `This PDF is ${size(used, max)}, and the ${name} plan takes files up to ${formatBytes(max)}. Compress or split it, or ${lower(hint)}`;
    case 'envelopeBytes':
      return `These PDFs add up to ${size(used, max)}, and the ${name} plan takes up to ${formatBytes(max)} in one envelope. Send fewer or smaller files, or ${lower(hint)}`;
    case 'storageBytes':
      return `This workspace stores ${formatBytes(used)} of documents, and the ${name} plan holds ${formatBytes(max)}, so these files do not fit. ${hint}`;
    case 'ownedWorkspaces':
      return `You already own ${plural(used, `${name} workspace`)}, and each person can own ${max}. Use the one you have, ask to be invited to another, or ${lower(hint)}`;
  }
}

/** A size over the limit, never written the same as the limit itself. */
const size = (used: number, max: number) =>
  formatBytes(used) === formatBytes(max) ? `just over ${formatBytes(max)}` : formatBytes(used);

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const PERIODS: Partial<Record<CountedLimit, Period>> = {
  envelopesPerMonth: 'month',
  apiRequestsPerDay: 'day',
};

/** The error for a counted limit that would be passed by `used`. */
export function limitError(
  key: CountedLimit,
  used: number,
  max: number,
  plan: Plan,
  now = new Date(),
  field?: string,
): PlanLimitError {
  const period = PERIODS[key];
  return new PlanLimitError({
    limit: key,
    used,
    max,
    plan,
    message: countMessage(key, used, max, plan, now),
    ...(field ? { field } : {}),
    resetsAt: period ? resetsAt(period, now) : null,
  });
}

/** Throws when adding `adding` to the `used` count would pass the limit. */
export function assertRoom(
  workspace: WorkspacePlan | null,
  key: CountedLimit,
  used: number,
  adding = 1,
  field?: string,
) {
  const max = workspace?.limits[key];
  if (workspace && typeof max === 'number' && used + adding > max) {
    throw limitError(key, used, max, workspace.plan, new Date(), field);
  }
}

/** Throws when one use (a file's size, a bulk send's rows) is larger than the plan takes. */
export function assertWithin(
  workspace: WorkspacePlan | null,
  key: 'bulkRows' | 'fileBytes' | 'envelopeBytes',
  value: number,
  field?: string,
) {
  const max = workspace?.limits[key];
  if (workspace && typeof max === 'number' && value > max) {
    throw limitError(key, value, max, workspace.plan, new Date(), field);
  }
}

/**
 * Refuses a bulk send with more rows than envelopes left this month, before any is sent.
 * Each envelope is still counted as it is sent, so this is a courtesy, not the guard.
 */
export function assertSendsLeft(workspace: WorkspacePlan | null, used: number, rows: number) {
  const max = workspace?.limits.envelopesPerMonth;
  if (!workspace || typeof max !== 'number' || used + rows <= max) return;
  const now = new Date();
  const left = Math.max(0, max - used);
  throw new PlanLimitError({
    limit: 'envelopesPerMonth',
    used,
    max,
    plan: workspace.plan,
    field: 'csv',
    resetsAt: resetsAt('month', now),
    message: `This bulk send has ${plural(rows, 'row')}, and the ${PLAN_NAMES[workspace.plan]} plan has ${left} of its ${plural(max, 'envelope')} left this month. Send ${left === 0 ? 'it after the count starts again' : `at most ${left} rows`}, or ${lower(upgradeHint(workspace.plan))} The count starts again on ${formatDay(resetsAt('month', now)!)}.`,
  });
}

export function assertCustomDomain(workspace: WorkspacePlan | null) {
  if (workspace && !workspace.limits.customDomain) {
    throw new PlanLimitError({
      limit: 'customDomain',
      plan: workspace.plan,
      field: 'signingDomain',
      message: `Custom signing domains are not part of the ${PLAN_NAMES[workspace.plan]} plan. ${upgradeHint(workspace.plan)} Until then, signing links use this app's address.`,
    });
  }
}

export function assertBadgeOptional(workspace: WorkspacePlan | null) {
  if (workspace?.limits.badgeRequired) {
    throw new PlanLimitError({
      limit: 'badgeRequired',
      plan: workspace.plan,
      field: 'showBadge',
      message: `The ${PLAN_NAMES[workspace.plan]} plan always shows the "Secured by Codevibe Sign" badge. ${upgradeHint(workspace.plan)}`,
    });
  }
}

export type UsageMetric = 'envelopes_sent' | 'api_requests' | 'storage_bytes';

const METRIC_PERIOD: Record<UsageMetric, Period> = {
  envelopes_sent: 'month',
  api_requests: 'day',
  storage_bytes: 'total',
};

const METRIC_LIMIT: Record<UsageMetric, CountedLimit> = {
  envelopes_sent: 'envelopesPerMonth',
  api_requests: 'apiRequestsPerDay',
  storage_bytes: 'storageBytes',
};

export interface Reservation {
  workspaceId: string;
  metric: UsageMetric;
  period: string;
  amount: number;
}

/**
 * Adds `amount` to a usage counter only while the total stays within the plan, in one
 * statement: the row lock taken by the upsert makes concurrent reservations queue, so the
 * limit holds however many requests arrive together. Throws `PlanLimitError` when there is no
 * room; returns what to hand to `releaseUsage` if the work then fails.
 */
export async function reserveUsage(
  sql: Sql,
  workspace: WorkspacePlan & { id: string },
  metric: UsageMetric,
  amount: number,
  now = new Date(),
): Promise<Reservation | null> {
  const key = METRIC_LIMIT[metric];
  const max = workspace.limits[key];
  const period = periodKey(METRIC_PERIOD[metric], now);
  const reservation = { workspaceId: workspace.id, metric, period, amount };
  if (max === null) {
    await sql`insert into app_usage (workspace_id, metric, period, used)
      values (${workspace.id}, ${metric}, ${period}, ${amount})
      on conflict (workspace_id, metric, period)
      do update set used = app_usage.used + excluded.used, updated_at = now()`;
    return reservation;
  }
  const rows = await sql<{ used: string }[]>`
    insert into app_usage (workspace_id, metric, period, used)
    select ${workspace.id}, ${metric}, ${period}, ${amount} where ${amount}::bigint <= ${max}::bigint
    on conflict (workspace_id, metric, period)
    do update set used = app_usage.used + excluded.used, updated_at = now()
      where app_usage.used + excluded.used <= ${max}::bigint
    returning used`;
  if (rows.length > 0) return reservation;
  const used = await usageOf(sql, workspace.id, metric, now);
  throw limitError(key, used, max, workspace.plan, now);
}

/** Gives back a reservation whose work did not happen. */
export async function releaseUsage(sql: Sql, reservation: Reservation | null) {
  if (!reservation || reservation.amount === 0) return;
  await sql`update app_usage set used = greatest(used - ${reservation.amount}, 0), updated_at = now()
    where workspace_id = ${reservation.workspaceId} and metric = ${reservation.metric}
      and period = ${reservation.period}`;
}

/** Gives back the storage of files that were deleted for good. */
export async function releaseStorage(
  sql: Sql | postgres.TransactionSql,
  workspaceId: string,
  bytes: number,
) {
  if (bytes <= 0) return;
  await sql`update app_usage set used = greatest(used - ${bytes}, 0), updated_at = now()
    where workspace_id = ${workspaceId} and metric = 'storage_bytes'
      and period = ${periodKey(METRIC_PERIOD.storage_bytes, new Date())}`;
}

export async function usageOf(
  sql: Sql,
  workspaceId: string,
  metric: UsageMetric,
  now = new Date(),
): Promise<number> {
  const [row] = await sql<{ used: string }[]>`
    select used from app_usage where workspace_id = ${workspaceId} and metric = ${metric}
      and period = ${periodKey(METRIC_PERIOD[metric], now)}`;
  return Number(row?.used ?? 0);
}

/** Members plus invitations that can still be accepted. */
export async function countSeats(sql: Sql, workspaceId: string, now = new Date()) {
  const [row] = await sql<{ members: number; invited: number }[]>`
    select
      (select count(*)::int from app_members where workspace_id = ${workspaceId}) as members,
      (select count(*)::int from app_invitations where workspace_id = ${workspaceId}
        and accepted_at is null and revoked_at is null and expires_at > ${now}) as invited`;
  return { members: row?.members ?? 0, invited: row?.invited ?? 0 };
}

export interface UsageLine {
  key: CountedLimit;
  label: string;
  unit: 'count' | 'bytes';
  used: number;
  max: number | null;
  usedText: string;
  maxText: string | null;
  resetsAt: string | null;
}

/** Every meter of the Plan and usage page, counted in the database. */
export async function usageReport(
  sql: Sql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
  now = new Date(),
): Promise<WorkspacePlan & { lines: UsageLine[] }> {
  const workspace = await workspacePlan(sql, workspaceId, settings);
  const [counts] = await sql<{ templates: number; webhooks: number }[]>`
    select
      (select count(*)::int from app_templates
        where workspace_id = ${workspaceId} and archived_at is null) as templates,
      (select count(*)::int from app_webhooks where workspace_id = ${workspaceId}) as webhooks`;
  const seats = await countSeats(sql, workspaceId, now);
  const used: Partial<Record<CountedLimit, number>> = {
    envelopesPerMonth: await usageOf(sql, workspaceId, 'envelopes_sent', now),
    members: seats.members + seats.invited,
    activeTemplates: counts?.templates ?? 0,
    webhooks: counts?.webhooks ?? 0,
    apiRequestsPerDay: await usageOf(sql, workspaceId, 'api_requests', now),
    storageBytes: await usageOf(sql, workspaceId, 'storage_bytes', now),
  };
  const lines = METERS.map((meter): UsageLine => {
    const value = used[meter.key] ?? 0;
    const max = workspace.limits[meter.key];
    const reset = resetsAt(meter.period, now);
    return {
      key: meter.key,
      label: meter.label,
      unit: meter.unit,
      used: value,
      max,
      usedText: formatAmount(value, meter.unit),
      maxText: max === null ? null : formatAmount(max, meter.unit),
      resetsAt: reset ? formatDay(reset) : null,
    };
  });
  return { ...workspace, lines };
}
