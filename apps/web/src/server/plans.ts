import 'server-only';
import type postgres from 'postgres';
import {
  LIMIT_PERIODS,
  METERS,
  PLAN_MODES,
  PRICING_PATH,
  billingVisible,
  formatReset,
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
  type FeatureLimit,
  type Period,
  type Plan,
  type PlanLimits,
  type PlanMode,
  type PlanSettings,
} from '@/lib/plans';
import { AppError } from './errors';

type Sql = postgres.Sql | postgres.TransactionSql;

/** What a refused request is told about the limit it met. Plain data, safe to send to a browser. */
export type PlanLimitDetails = {
  limit: CountedLimit | FeatureLimit;
  used: number | null;
  max: number | null;
  plan: Plan;
  /** Where the plans are compared. */
  upgradeUrl: string;
  /** When the count starts again, for limits that reset. */
  resetsAt?: string;
};

/**
 * A plan limit was reached. The message names the limit, the usage and what to do, and the
 * fields let the API answer with the numbers too.
 */
export class PlanLimitError extends AppError {
  readonly limit: CountedLimit | FeatureLimit;
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

  /** Seconds until the count starts again, for `Retry-After`; null for limits that do not reset. */
  retryAfterSeconds(now = new Date()): number | null {
    if (!this.resetsAt) return null;
    return Math.max(1, Math.ceil((this.resetsAt.getTime() - now.getTime()) / 1000));
  }

  /** 429 for a count that starts again by itself, 403 for everything else. */
  get status(): 403 | 429 {
    return this.limit === 'apiRequestsPerMonth' || this.limit === 'apiRequestsPerDay' ? 429 : 403;
  }

  /** The numbers behind the message, for an API answer or an upgrade prompt. */
  details(): PlanLimitDetails {
    return {
      limit: this.limit,
      used: this.used,
      max: this.max,
      plan: this.plan,
      upgradeUrl: upgradeUrl(),
      ...(this.resetsAt ? { resetsAt: this.resetsAt.toISOString() } : {}),
    };
  }

  /** The body the API answers with. */
  toJSON() {
    return { error: { code: 'PLAN_LIMIT', message: this.message, details: this.details() } };
  }
}

/** Where the plans are compared: the pricing section of this install, as a full address. */
export function upgradeUrl(source: NodeJS.ProcessEnv = process.env): string {
  const base = source.APP_URL?.trim().replace(/\/+$/, '') ?? '';
  return `${base}${PRICING_PATH}`;
}

/**
 * `CLOUD_INCLUDED_MEMBERS`, the one plan number the operator's billing settings own. Read
 * here rather than through the billing settings so a mistake in an unrelated billing value
 * cannot take the plan checks down with it.
 */
function cloudIncludedMembers(source: NodeJS.ProcessEnv): number | undefined {
  const raw = source.CLOUD_INCLUDED_MEMBERS?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`CLOUD_INCLUDED_MEMBERS must be a whole number of 1 or more, not "${raw}"`);
  }
  return value;
}

/**
 * `PLAN_MODE`, `FREE_PLAN_LIMITS` and `CLOUD_INCLUDED_MEMBERS`, read from the environment on
 * every call.
 */
export function planSettings(source: NodeJS.ProcessEnv = process.env): PlanSettings {
  const mode = (source.PLAN_MODE?.trim() || 'self-hosted') as PlanMode;
  if (!PLAN_MODES.includes(mode)) {
    throw new Error(`PLAN_MODE must be "self-hosted" or "hosted", not "${source.PLAN_MODE}"`);
  }
  const included = cloudIncludedMembers(source);
  return {
    mode,
    freeOverrides: parseLimitOverrides(source.FREE_PLAN_LIMITS),
    ...(included !== undefined ? { cloudIncludedMembers: included } : {}),
  };
}

export const isHosted = (settings: PlanSettings = planSettings()) => settings.mode === 'hosted';

/** The plan a new workspace starts on. */
export const startingPlan = (settings: PlanSettings = planSettings()): Plan =>
  settings.mode === 'hosted' ? 'free' : 'unlimited';

export interface WorkspacePlan {
  plan: Plan;
  limits: PlanLimits;
  /**
   * The account the workspace belongs to, whose plan this is and across whose workspaces every
   * count is taken. Null on a self-hosted install, where nothing is counted.
   */
  accountId: string | null;
}

async function readPlan(
  sql: Sql,
  workspaceId: string,
  lock: boolean,
  settings: PlanSettings,
): Promise<WorkspacePlan> {
  const [row] = await sql<{ id: string; plan: string; extra_seats: number }[]>`
    select a.id, a.plan, a.extra_seats
    from app_accounts a join app_workspaces w on w.account_id = a.id
    where w.id = ${workspaceId}
    ${lock ? sql`for update of a` : sql``}`;
  if (!row) throw new AppError('NOT_FOUND', 'Workspace not found');
  const plan = isPlan(row.plan) ? row.plan : 'free';
  return { plan, limits: limitsFor(plan, settings, row.extra_seats), accountId: row.id };
}

/** The plan of the account a workspace belongs to. */
export async function workspacePlan(
  sql: Sql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
): Promise<WorkspacePlan> {
  if (settings.mode === 'self-hosted')
    return { plan: 'unlimited', limits: limitsFor('unlimited', settings), accountId: null };
  return readPlan(sql, workspaceId, false, settings);
}

/**
 * The plan of a workspace's account, read with the account's row locked for the rest of the
 * transaction. Adding a member, template or webhook counts and inserts under this lock, so
 * two requests at once, in the same workspace or in two workspaces of one account, cannot
 * both take the last place.
 */
export async function lockedPlan(
  tx: postgres.TransactionSql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
): Promise<(WorkspacePlan & { accountId: string }) | null> {
  if (settings.mode === 'self-hosted') return null;
  return (await readPlan(tx, workspaceId, true, settings)) as WorkspacePlan & { accountId: string };
}

export interface Entitlements extends WorkspacePlan {
  /** Plans, prices and billing exist on this install. False when self-hosted. */
  billingVisible: boolean;
  /** Aadhaar eSign may go through the workspace's own provider account. */
  ownEsignAccount: boolean;
  /** Events are delivered to the workspace's webhook endpoints. */
  webhooks: boolean;
}

/** What a workspace may do right now, for a page or a check that needs more than one answer. */
export async function workspaceEntitlements(
  sql: Sql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
): Promise<Entitlements> {
  const workspace = await workspacePlan(sql, workspaceId, settings);
  return {
    ...workspace,
    billingVisible: billingVisible(settings),
    ownEsignAccount: workspace.limits.ownEsignAccount,
    webhooks: workspace.limits.webhooks !== 0,
  };
}

/**
 * Refuses a workspace whose plan cannot connect its own eSign provider account. Call it when
 * the account is saved and again each time it is about to be used, so a workspace that left
 * Cloud stops using it.
 */
export async function assertOwnEsignAccount(
  sql: Sql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
): Promise<void> {
  const workspace = await workspacePlan(sql, workspaceId, settings);
  if (workspace.limits.ownEsignAccount) return;
  throw new PlanLimitError({
    limit: 'ownEsignAccount',
    plan: workspace.plan,
    field: 'mode',
    message: `Connecting your own Leegality account is not part of the ${PLAN_NAMES[workspace.plan]} plan. ${upgradeHint(workspace.plan)} Until then, Aadhaar eSign here uses prepaid credits.`,
  });
}

/**
 * Refuses a workspace whose plan has no webhooks: adding or turning on an endpoint, a test
 * event, sending a delivery again. Endpoints it already has stay listed and can be edited or
 * removed; they receive nothing until the plan includes webhooks again.
 */
export function assertWebhooksIncluded(workspace: WorkspacePlan | null) {
  if (workspace && workspace.limits.webhooks === 0) {
    throw new PlanLimitError({
      limit: 'webhooks',
      used: 0,
      max: 0,
      plan: workspace.plan,
      message: `Webhooks are not part of the ${PLAN_NAMES[workspace.plan]} plan, so this workspace's endpoints are paused. ${upgradeHint(workspace.plan)}`,
    });
  }
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

function countMessage(key: CountedLimit, used: number, max: number, plan: Plan, now: Date): string {
  const name = PLAN_NAMES[plan];
  const hint = upgradeHint(plan);
  switch (key) {
    case 'envelopesPerMonth':
      return `Your workspaces have sent ${used} of the ${plural(max, 'envelope')} the ${name} plan allows each month. ${hint} The count starts again on ${formatDay(resetsAt('month', now)!)}.`;
    case 'members':
      return `This account has ${plural(used, 'member')} and open invitations across its workspaces, and the ${name} plan allows ${max}. Remove someone or cancel an invitation, or ${lower(hint)}`;
    case 'activeTemplates':
      return `This account has ${plural(used, 'active template')} across its workspaces, and the ${name} plan allows ${max}. Archive a template you no longer use, or ${lower(hint)}`;
    case 'webhooks':
      return `This account has ${plural(used, 'webhook endpoint')} across its workspaces, and the ${name} plan allows ${max}. Remove one first, or ${lower(hint)}`;
    case 'bulkRows':
      return `This file has ${plural(used, 'row')}, and the ${name} plan sends up to ${max} in one bulk send. Split it into files of ${max} rows, or ${lower(hint)}`;
    case 'apiRequestsPerMonth':
      return `Your workspaces have made ${used} of the ${plural(max, 'API request')} the ${name} plan allows each month. The count starts again on ${formatReset('ist-month', resetsAt('ist-month', now)!)}. For more, ${lower(hint)}`;
    case 'apiRequestsPerDay':
      return `Your workspaces have made ${used} of the ${plural(max, 'API request')} the ${name} plan allows each day. Try again after 00:00 UTC, or ${lower(hint)}`;
    case 'fileBytes':
      return `This PDF is ${size(used, max)}, and the ${name} plan takes files up to ${formatBytes(max)}. Compress or split it, or ${lower(hint)}`;
    case 'envelopeBytes':
      return `These PDFs add up to ${size(used, max)}, and the ${name} plan takes up to ${formatBytes(max)} in one envelope. Send fewer or smaller files, or ${lower(hint)}`;
    case 'storageBytes':
      return `Your workspaces store ${formatBytes(used)} of documents, and the ${name} plan holds ${formatBytes(max)}, so these files do not fit. ${hint}`;
    case 'ownedWorkspaces':
      return `Your account already has ${plural(used, 'workspace')}, and the ${name} plan includes ${max}. Use the one you have, or ${lower(hint)} Being invited to someone else's workspace is always possible.`;
  }
}

/** A size over the limit, never written the same as the limit itself. */
const size = (used: number, max: number) =>
  formatBytes(used) === formatBytes(max) ? `just over ${formatBytes(max)}` : formatBytes(used);

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The error for a counted limit that would be passed by `used`. */
export function limitError(
  key: CountedLimit,
  used: number,
  max: number,
  plan: Plan,
  now = new Date(),
  field?: string,
): PlanLimitError {
  const period = LIMIT_PERIODS[key];
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

export type UsageMetric =
  | 'envelopes_sent'
  | 'api_requests'
  | 'api_requests_month'
  | 'storage_bytes';

const METRIC_LIMIT: Record<UsageMetric, CountedLimit> = {
  envelopes_sent: 'envelopesPerMonth',
  api_requests: 'apiRequestsPerDay',
  api_requests_month: 'apiRequestsPerMonth',
  storage_bytes: 'storageBytes',
};

const METRIC_PERIOD: Record<UsageMetric, Period> = {
  envelopes_sent: 'month',
  api_requests: 'day',
  api_requests_month: 'ist-month',
  storage_bytes: 'total',
};

export interface Reservation {
  workspaceId: string;
  metric: UsageMetric;
  period: string;
  amount: number;
}

/** Runs `work` atomically: a new transaction, or a savepoint inside the caller's. */
function atomic<T>(sql: Sql, work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const run = 'savepoint' in sql ? sql.savepoint(work) : sql.begin(work);
  return run as Promise<T>;
}

/**
 * Adds `amount` to a workspace's usage counter only while the total of its account stays
 * within the plan. The counter is kept per workspace, for the breakdown; the check is on the
 * sum over the account's workspaces, taken with the account's row locked, so the limit holds
 * however many requests arrive together and whichever workspaces they come through. Throws
 * `PlanLimitError` when there is no room; returns what to hand to `releaseUsage` if the work
 * then fails.
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
  const add = (db: Sql) => db`insert into app_usage (workspace_id, metric, period, used)
      values (${workspace.id}, ${metric}, ${period}, ${amount})
      on conflict (workspace_id, metric, period)
      do update set used = app_usage.used + excluded.used, updated_at = now()`;
  const accountId = workspace.accountId;
  if (max === null || accountId === null) {
    await add(sql);
    return reservation;
  }
  return atomic(sql, async (tx) => {
    await tx`select 1 from app_accounts where id = ${accountId} for update`;
    const used = await accountUsageOf(tx, accountId, metric, now);
    if (used + amount > max) throw limitError(key, used, max, workspace.plan, now);
    await add(tx);
    return reservation;
  });
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

/** A usage counter summed over every workspace of an account: what a limit is checked against. */
export async function accountUsageOf(
  sql: Sql,
  accountId: string,
  metric: UsageMetric,
  now = new Date(),
): Promise<number> {
  const [row] = await sql<{ used: string }[]>`
    select coalesce(sum(u.used), 0) as used
    from app_usage u join app_workspaces w on w.id = u.workspace_id
    where w.account_id = ${accountId} and u.metric = ${metric}
      and u.period = ${periodKey(METRIC_PERIOD[metric], now)}`;
  return Number(row?.used ?? 0);
}

/**
 * The people of an account: everyone who is a member of any of its workspaces, each counted
 * once, plus open invitations to addresses that are not one of them yet (an address invited to
 * two workspaces counts once too).
 */
export async function countSeats(sql: Sql, accountId: string, now = new Date()) {
  const [row] = await sql<{ members: number; invited: number }[]>`
    with people as (
      select distinct m.user_id
      from app_members m join app_workspaces w on w.id = m.workspace_id
      where w.account_id = ${accountId}
    )
    select
      (select count(*)::int from people) as members,
      (select count(distinct lower(i.email))::int
        from app_invitations i join app_workspaces w on w.id = i.workspace_id
        where w.account_id = ${accountId}
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > ${now}
          and not exists (
            select 1 from people p join auth_users u on u.id = p.user_id
            where lower(u.email) = lower(i.email)
          )) as invited`;
  return { members: row?.members ?? 0, invited: row?.invited ?? 0 };
}

/**
 * Whether a person, by id or by email address, already counts as one of the account's people:
 * a member of one of its workspaces or, for an address, someone with an open invitation to
 * one. Adding them to another workspace of the account takes no further place.
 */
export async function isAccountPerson(
  sql: Sql,
  accountId: string,
  who: { userId: string } | { email: string },
  now = new Date(),
): Promise<boolean> {
  if ('email' in who) {
    const [invited] = await sql`
      select 1 from app_invitations i join app_workspaces w on w.id = i.workspace_id
      where w.account_id = ${accountId} and lower(i.email) = ${who.email.toLowerCase()}
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > ${now}
      limit 1`;
    if (invited) return true;
  }
  const [row] = await sql`
    select 1 from app_members m
    join app_workspaces w on w.id = m.workspace_id
    join auth_users u on u.id = m.user_id
    where w.account_id = ${accountId}
      and ${'userId' in who ? sql`u.id = ${who.userId}` : sql`lower(u.email) = ${who.email.toLowerCase()}`}
    limit 1`;
  return Boolean(row);
}

/** Templates that are not archived, in every workspace of the account. */
export async function countActiveTemplates(sql: Sql, accountId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from app_templates t join app_workspaces w on w.id = t.workspace_id
    where w.account_id = ${accountId} and t.archived_at is null`;
  return row?.n ?? 0;
}

/** Webhook endpoints in every workspace of the account. */
export async function countWebhooks(sql: Sql, accountId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from app_webhooks h join app_workspaces w on w.id = h.workspace_id
    where w.account_id = ${accountId}`;
  return row?.n ?? 0;
}

/** Workspaces that belong to the account. */
export async function countAccountWorkspaces(sql: Sql, accountId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from app_workspaces where account_id = ${accountId}`;
  return row?.n ?? 0;
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

/** What one workspace adds to its account's usage, for the breakdown on Plan and usage. */
export interface WorkspaceUsage {
  id: string;
  slug: string;
  name: string;
  members: number;
  activeTemplates: number;
  envelopes: number;
  apiRequests: number;
  storageBytes: number;
  storageText: string;
  esigns: number;
}

/**
 * Every meter of the Plan and usage page, counted in the database over the whole account,
 * and what each of its workspaces adds.
 */
export async function usageReport(
  sql: Sql,
  workspaceId: string,
  settings: PlanSettings = planSettings(),
  now = new Date(),
): Promise<WorkspacePlan & { lines: UsageLine[]; workspaces: WorkspaceUsage[] }> {
  const account = await readPlan(sql, workspaceId, false, settings);
  const selfHosted = settings.mode === 'self-hosted';
  const workspace: WorkspacePlan = selfHosted ? { ...account, plan: 'unlimited' } : account;
  const limits = selfHosted ? limitsFor('unlimited', settings) : account.limits;
  const accountId = account.accountId!;
  const apiMetric: UsageMetric =
    limits.apiRequestsPerMonth === null && limits.apiRequestsPerDay !== null
      ? 'api_requests'
      : 'api_requests_month';
  const rows = await sql<
    {
      id: string;
      slug: string;
      name: string;
      members: number;
      templates: number;
      envelopes: string;
      api: string;
      storage: string;
      esigns: number;
    }[]
  >`
    select w.id, w.slug, w.name,
      (select count(*)::int from app_members m where m.workspace_id = w.id) as members,
      (select count(*)::int from app_templates t
        where t.workspace_id = w.id and t.archived_at is null) as templates,
      coalesce((select used from app_usage u where u.workspace_id = w.id
        and u.metric = 'envelopes_sent'
        and u.period = ${periodKey(METRIC_PERIOD.envelopes_sent, now)}), 0) as envelopes,
      coalesce((select used from app_usage u where u.workspace_id = w.id
        and u.metric = ${apiMetric}
        and u.period = ${periodKey(METRIC_PERIOD[apiMetric], now)}), 0) as api,
      coalesce((select used from app_usage u where u.workspace_id = w.id
        and u.metric = 'storage_bytes' and u.period = 'total'), 0) as storage,
      (select count(*)::int from app_esign_usage e
        where e.workspace_id = w.id and e.outcome = 'signed'
          and e.started_at >= date_trunc('month', ${now}::timestamptz)) as esigns
    from app_workspaces w where w.account_id = ${accountId}
    order by w.created_at, w.id`;
  const workspaces = rows.map(
    (row): WorkspaceUsage => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      members: row.members,
      activeTemplates: row.templates,
      envelopes: Number(row.envelopes),
      apiRequests: Number(row.api),
      storageBytes: Number(row.storage),
      storageText: formatBytes(Number(row.storage)),
      esigns: row.esigns,
    }),
  );
  const seats = await countSeats(sql, accountId, now);
  const used: Partial<Record<CountedLimit, number>> = {
    ownedWorkspaces: workspaces.length,
    envelopesPerMonth: await accountUsageOf(sql, accountId, 'envelopes_sent', now),
    members: seats.members + seats.invited,
    activeTemplates: await countActiveTemplates(sql, accountId),
    webhooks: await countWebhooks(sql, accountId),
    apiRequestsPerMonth: await accountUsageOf(sql, accountId, 'api_requests_month', now),
    apiRequestsPerDay: await accountUsageOf(sql, accountId, 'api_requests', now),
    storageBytes: await accountUsageOf(sql, accountId, 'storage_bytes', now),
  };
  // A plan counts API requests by the month or under a daily ceiling, never both.
  const shown = METERS.filter((meter) => {
    if (meter.key === 'apiRequestsPerDay')
      return !(limits.apiRequestsPerDay === null && limits.apiRequestsPerMonth !== null);
    if (meter.key === 'apiRequestsPerMonth')
      return !(limits.apiRequestsPerMonth === null && limits.apiRequestsPerDay !== null);
    return true;
  });
  const lines = shown.map((meter): UsageLine => {
    const value = used[meter.key] ?? 0;
    const max = limits[meter.key];
    const reset = resetsAt(meter.period, now);
    return {
      key: meter.key,
      label: meter.label,
      unit: meter.unit,
      used: value,
      max,
      usedText: formatAmount(value, meter.unit),
      maxText: max === null ? null : formatAmount(max, meter.unit),
      resetsAt: reset ? formatReset(meter.period, reset) : null,
    };
  });
  return { ...workspace, limits, lines, workspaces };
}
