import 'server-only';
import { can } from '@/lib/roles';
import { db } from './db';
import { recordSender } from './envelopes';
import { openBulkSends, runBulkSend, type BulkRowRecord, type BulkSendRecord } from './bulk-sends';
import { AppError } from './errors';
import { appRuntime } from './runtime';
import { signRequest } from './sign/client';
import { RateLimitedError, sendFromTemplate } from './template-send';
import { getTemplate } from './templates';
import { findMembership } from './workspaces';

const running = new Set<string>();

function describe(err: unknown): string {
  if (err instanceof AppError) return err.message;
  console.error('bulk send row failed', err instanceof Error ? err.message : err);
  return 'Something went wrong on our side. Send this one again from the template.';
}

/** Sends one bulk-send row as the person who started the bulk send. */
async function sendRow(
  bulk: Pick<BulkSendRecord, 'id' | 'workspaceId' | 'templateId' | 'createdBy'>,
  row: BulkRowRecord,
) {
  const sql = db();
  if (!bulk.createdBy) {
    throw new AppError(
      'FORBIDDEN',
      'The person who started this bulk send no longer has an account.',
    );
  }
  const membership = await findMembership(sql, bulk.createdBy, { id: bulk.workspaceId });
  if (!membership || !can(membership.role, 'envelopes.write')) {
    throw new AppError(
      'FORBIDDEN',
      'The person who started this bulk send can no longer send from this workspace.',
    );
  }
  const template = await getTemplate(sql, bulk.workspaceId, bulk.templateId);
  if (!template) throw new AppError('NOT_FOUND', 'The template was deleted.');
  const envelope = await sendFromTemplate(
    {
      files: appRuntime().files,
      request: signRequest,
      recordSender: (input) => recordSender(sql, input),
    },
    {
      template,
      userId: bulk.createdBy,
      people: row.people,
      metadata: { ...row.metadata, bulkSendId: bulk.id, bulkSendLine: String(row.line) },
    },
  );
  return { envelopeId: envelope.id };
}

/** Works through a bulk send in this process, unless it is already running here. */
export async function processBulkSend(
  bulk: Pick<BulkSendRecord, 'id' | 'workspaceId' | 'templateId' | 'createdBy'>,
) {
  if (running.has(bulk.id)) return;
  running.add(bulk.id);
  try {
    await runBulkSend(
      {
        sql: db(),
        now: () => new Date(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        send: (row) => sendRow(bulk, row),
        isRateLimit: (err) => (err instanceof RateLimitedError ? err.retryAfterSeconds : null),
        describe,
      },
      bulk.id,
    );
  } finally {
    running.delete(bulk.id);
  }
}

/** Picks up bulk sends that stopped part way, for example when the server restarted. */
export async function resumeBulkSends() {
  const sql = db();
  for (const open of await openBulkSends(sql, new Date())) {
    const [bulk] = await sql<
      Pick<BulkSendRecord, 'id' | 'workspaceId' | 'templateId' | 'createdBy'>[]
    >`
      select id, workspace_id as "workspaceId", template_id as "templateId", created_by as "createdBy"
      from app_bulk_sends where id = ${open.id}`;
    if (bulk)
      void processBulkSend(bulk).catch((err: unknown) =>
        console.error('[bulk] failed', err instanceof Error ? err.message : err),
      );
  }
}
