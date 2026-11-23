import 'server-only';
import type { WebhookDeliveryReport, WebhookTarget } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import {
  DELIVERY_RETENTION_DAYS,
  MAX_WEBHOOKS,
  deliveryStatus,
  normalizeEvents,
  webhookProblems,
  type DeliveryStatus,
  type WebhookInput,
} from '@/lib/webhooks';
import { randomId, randomSecret } from './crypto';
import { AppError } from './errors';
import { assertRoom, assertWebhooksIncluded, lockedPlan, workspacePlan } from './plans';
import { userLabel } from './profile';

type Sql = postgres.Sql;

export const WEBHOOK_SECRET_PREFIX = 'whsec_';

export interface WebhookRecord {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
  lastDelivery: { status: DeliveryStatus; at: Date } | null;
}

export interface DeliveryRecord {
  deliveryId: string;
  webhookId: string;
  url: string;
  event: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextRetryAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  lastAttemptAt: Date;
}

export interface WebhookRules {
  /** Accept `http://` URLs too; for a receiver on the operator's own machine. */
  allowInsecure?: boolean;
  /** The sign server's own URL check (scheme, port, host shape); throws with a reason. */
  checkUrl?: (url: string) => void;
}

function clean(input: WebhookInput, rules: WebhookRules) {
  const problems = webhookProblems(input, rules);
  const first = Object.entries(problems)[0];
  if (first) throw new AppError('VALIDATION', first[1], first[0]);
  const url = input.url.trim();
  if (rules.checkUrl) {
    try {
      rules.checkUrl(url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'The URL cannot receive events';
      throw new AppError('VALIDATION', `${reason}. Use a public https:// address.`, 'url');
    }
  }
  return {
    url,
    description: input.description.trim() || null,
    events: normalizeEvents(input.events),
  };
}

const newSecret = () => `${WEBHOOK_SECRET_PREFIX}${randomSecret()}`;

async function unique<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('CONFLICT', 'This workspace already sends to that URL.', 'url');
    }
    throw err;
  }
}

/** Adds an endpoint and returns its signing secret. This is the only time it is shown. */
export async function createWebhook(
  sql: Sql,
  input: WebhookInput & { workspaceId: string; createdBy: string },
  rules: WebhookRules = {},
): Promise<{ id: string; secret: string }> {
  const values = clean(input, rules);
  const id = randomId('wh');
  const secret = newSecret();
  await sql.begin(async (tx) => {
    const plan = await lockedPlan(tx, input.workspaceId);
    assertWebhooksIncluded(plan);
    const [count] = await tx<{ n: number }[]>`
      select count(*)::int as n from app_webhooks where workspace_id = ${input.workspaceId}`;
    const used = count?.n ?? 0;
    assertRoom(plan, 'webhooks', used);
    if (used >= MAX_WEBHOOKS) {
      throw new AppError(
        'CONFLICT',
        `A workspace can have up to ${MAX_WEBHOOKS} endpoints. Remove one first.`,
      );
    }
    await unique(
      () => tx`insert into app_webhooks (id, workspace_id, url, description, events, secret, created_by)
        values (${id}, ${input.workspaceId}, ${values.url}, ${values.description}, ${values.events},
          ${secret}, ${input.createdBy})`,
    );
  });
  return { id, secret };
}

export async function updateWebhook(
  sql: Sql,
  workspaceId: string,
  id: string,
  input: WebhookInput,
  rules: WebhookRules = {},
) {
  const values = clean(input, rules);
  const rows = await unique(
    () => sql`update app_webhooks set url = ${values.url}, description = ${values.description},
      events = ${values.events}, updated_at = now()
      where id = ${id} and workspace_id = ${workspaceId} returning id`,
  );
  if (rows.length === 0) throw notFound();
}

export async function setWebhookEnabled(
  sql: Sql,
  workspaceId: string,
  id: string,
  enabled: boolean,
) {
  const rows = await sql.begin(async (tx) => {
    // Turning an endpoint off is always allowed; turning one on needs a plan with webhooks.
    if (enabled) assertWebhooksIncluded(await lockedPlan(tx, workspaceId));
    return tx`update app_webhooks set enabled = ${enabled}, updated_at = now()
      where id = ${id} and workspace_id = ${workspaceId} returning id`;
  });
  if (rows.length === 0) throw notFound();
}

/**
 * Refuses to send anything to a workspace's endpoints by hand (a test event, a delivery sent
 * again) while its plan has no webhooks.
 */
export async function assertWebhooksLive(sql: Sql, workspaceId: string) {
  assertWebhooksIncluded(await workspacePlan(sql, workspaceId));
}

/** A new secret; the old one stops working at once. */
export async function rollWebhookSecret(
  sql: Sql,
  workspaceId: string,
  id: string,
): Promise<string> {
  const secret = newSecret();
  const rows = await sql`update app_webhooks set secret = ${secret}, updated_at = now()
    where id = ${id} and workspace_id = ${workspaceId} returning id`;
  if (rows.length === 0) throw notFound();
  return secret;
}

export async function deleteWebhook(sql: Sql, workspaceId: string, id: string) {
  const rows =
    await sql`delete from app_webhooks where id = ${id} and workspace_id = ${workspaceId} returning id`;
  if (rows.length === 0) throw notFound();
}

const notFound = () =>
  new AppError('NOT_FOUND', 'That endpoint no longer exists in this workspace.');

const SELECT = (sql: Sql) => sql`
  select w.id, w.url, w.description, w.events, w.enabled, w.created_at as "createdAt",
    w.updated_at as "updatedAt", ${userLabel(sql)} as "createdByName",
    (select json_build_object('status', d.status, 'at', d.last_attempt_at)
       from app_webhook_deliveries d where d.webhook_id = w.id
       order by d.last_attempt_at desc limit 1) as "lastDelivery"
  from app_webhooks w left join auth_users u on u.id = w.created_by`;

type Row = Omit<WebhookRecord, 'lastDelivery'> & {
  lastDelivery: { status: DeliveryStatus; at: string } | null;
};

const toRecord = (row: Row): WebhookRecord => ({
  ...row,
  lastDelivery: row.lastDelivery
    ? { status: row.lastDelivery.status, at: new Date(row.lastDelivery.at) }
    : null,
});

export async function listWebhooks(sql: Sql, workspaceId: string): Promise<WebhookRecord[]> {
  const rows = await sql<
    Row[]
  >`${SELECT(sql)} where w.workspace_id = ${workspaceId} order by w.created_at`;
  return rows.map(toRecord);
}

export async function getWebhook(
  sql: Sql,
  workspaceId: string,
  id: string,
): Promise<WebhookRecord | null> {
  const [row] = await sql<
    Row[]
  >`${SELECT(sql)} where w.id = ${id} and w.workspace_id = ${workspaceId}`;
  return row ? toRecord(row) : null;
}

/**
 * The workspace's live endpoints, as the sign server delivers to them: none while its plan
 * has no webhooks, so events are not queued and deliveries already waiting to be retried stop.
 * A workspace that no longer exists has none either.
 */
export async function webhookTargetsFor(sql: Sql, workspaceId: string): Promise<WebhookTarget[]> {
  const plan = await workspacePlan(sql, workspaceId).catch(() => null);
  if (!plan || plan.limits.webhooks === 0) return [];
  return sql<WebhookTarget[]>`select url, secret, events from app_webhooks
    where workspace_id = ${workspaceId} and enabled order by created_at`;
}

/**
 * Keeps one row per delivery and URL, updated on every attempt. Reports for workspaces or
 * endpoints that no longer exist are dropped.
 */
export async function recordDelivery(sql: Sql, report: WebhookDeliveryReport) {
  const status = deliveryStatus(report);
  await sql`insert into app_webhook_deliveries (workspace_id, delivery_id, webhook_id, url, event, body,
      status, attempts, response_status, error, next_retry_at, duration_ms, created_at, last_attempt_at)
    select w.workspace_id, ${report.deliveryId}, w.id, ${report.url}, ${report.event.slice(0, 100)},
      ${report.body}, ${status}, 1, ${report.status}, ${report.error?.slice(0, 1000) ?? null},
      ${report.retryAt}, ${report.durationMs}, ${report.at}, ${report.at}
    from app_webhooks w where w.workspace_id = ${report.workspaceId} and w.url = ${report.url}
    on conflict (webhook_id, delivery_id) do update set
      url = excluded.url,
      status = excluded.status,
      attempts = app_webhook_deliveries.attempts + 1,
      response_status = excluded.response_status,
      error = excluded.error,
      next_retry_at = excluded.next_retry_at,
      duration_ms = excluded.duration_ms,
      last_attempt_at = excluded.last_attempt_at`;
}

export async function listDeliveries(
  sql: Sql,
  workspaceId: string,
  webhookId: string,
  options: { status?: DeliveryStatus | 'problems'; before?: Date; limit?: number } = {},
): Promise<DeliveryRecord[]> {
  const filter =
    options.status === 'problems'
      ? sql`and d.status in ('failed', 'retrying')`
      : options.status
        ? sql`and d.status = ${options.status}`
        : sql``;
  return sql<DeliveryRecord[]>`
    select d.delivery_id as "deliveryId", d.webhook_id as "webhookId", d.url, d.event, d.body,
      d.status, d.attempts, d.response_status as "responseStatus", d.error,
      d.next_retry_at as "nextRetryAt", d.duration_ms as "durationMs", d.created_at as "createdAt",
      d.last_attempt_at as "lastAttemptAt"
    from app_webhook_deliveries d
    where d.workspace_id = ${workspaceId} and d.webhook_id = ${webhookId} ${filter}
      ${options.before ? sql`and d.created_at < ${options.before}` : sql``}
    order by d.created_at desc
    limit ${options.limit ?? 50}`;
}

export async function getDelivery(
  sql: Sql,
  workspaceId: string,
  webhookId: string,
  deliveryId: string,
): Promise<DeliveryRecord | null> {
  const [row] = await sql<DeliveryRecord[]>`
    select d.delivery_id as "deliveryId", d.webhook_id as "webhookId", d.url, d.event, d.body,
      d.status, d.attempts, d.response_status as "responseStatus", d.error,
      d.next_retry_at as "nextRetryAt", d.duration_ms as "durationMs", d.created_at as "createdAt",
      d.last_attempt_at as "lastAttemptAt"
    from app_webhook_deliveries d
    where d.workspace_id = ${workspaceId} and d.webhook_id = ${webhookId}
      and d.delivery_id = ${deliveryId}`;
  return row ?? null;
}

/** Drops log rows older than the retention period. */
export async function pruneDeliveries(sql: Sql, now = new Date()) {
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000);
  await sql`delete from app_webhook_deliveries where last_attempt_at < ${cutoff}`;
}
