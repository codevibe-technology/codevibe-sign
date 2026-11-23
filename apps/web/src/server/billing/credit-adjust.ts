import 'server-only';
import type postgres from 'postgres';
import { randomId } from '../crypto';
import { recordAudit } from './audit';
import type { Reversal } from './orders';

type Tx = postgres.TransactionSql;

/**
 * Removes up to `upTo` unused credits from a workspace and writes one `void` ledger line for
 * what was removed. Credits held by a running eSign, and spent ones, are left alone, so the
 * balance never goes below zero. Once per `ref`. Returns how many were removed.
 */
export async function voidCredits(
  tx: Tx,
  input: { workspaceId: string; upTo: number; ref: string; reason: string },
): Promise<number> {
  const [row] = await tx<{ available: number }[]>`
    select available from app_esign_credits where workspace_id = ${input.workspaceId} for update`;
  const take = Math.min(row?.available ?? 0, Math.max(0, input.upTo));
  if (take < 1) return 0;
  const written = await tx`
    insert into app_esign_credit_ledger (id, workspace_id, kind, credits, ref, reason)
    values (${randomId('crl')}, ${input.workspaceId}, 'void', ${take}, ${input.ref}, ${input.reason})
    on conflict (workspace_id, kind, ref) do nothing
    returning id`;
  if (written.length !== 1) return 0;
  await tx`
    update app_esign_credits set available = available - ${take}, updated_at = now()
    where workspace_id = ${input.workspaceId}`;
  return take;
}

/** A refunded credits order loses the credits it added, as far as they are not used yet. */
export const reverseCredits: Reversal = async (tx, order) => {
  const credits = order.payload.credits;
  if (!order.workspaceId || typeof credits !== 'number') return;
  const taken = await voidCredits(tx, {
    workspaceId: order.workspaceId,
    upTo: credits,
    ref: `refund:${order.id}`,
    reason: 'refund',
  });
  return { creditsTakenBack: taken, creditsAlreadyUsed: credits - taken };
};

/**
 * On a live install, removes credits that were bought with test payments and are still
 * unused. Use is counted against test credits first, so a credit paid for with real money is
 * never removed. Run from the background tick; a second run finds nothing left to do.
 */
export async function voidTestCredits(sql: postgres.Sql, now: Date): Promise<number> {
  const rows = await sql<{ workspace_id: string }[]>`
    select distinct l.workspace_id
    from app_esign_credit_ledger l
    join app_esign_credits c on c.workspace_id = l.workspace_id
    where l.kind = 'grant' and l.mode = 'test' and c.available > 0
    limit 200`;
  let removed = 0;
  for (const { workspace_id: workspaceId } of rows) {
    removed += await sql.begin(async (tx) => {
      await tx`select 1 from app_esign_credits where workspace_id = ${workspaceId} for update`;
      const [sums] = await tx<{ test: number; used: number; voided: number }[]>`
        select
          coalesce(sum(credits) filter (where kind = 'grant' and mode = 'test'), 0)::int as test,
          coalesce(sum(credits) filter (where kind = 'consume'), 0)::int as used,
          coalesce(sum(credits) filter (where kind = 'void' and reason = 'test'), 0)::int as voided
        from app_esign_credit_ledger where workspace_id = ${workspaceId}`;
      const left = (sums?.test ?? 0) - (sums?.used ?? 0) - (sums?.voided ?? 0);
      const taken = await voidCredits(tx, {
        workspaceId,
        upTo: left,
        ref: `test:${now.toISOString()}`,
        reason: 'test',
      });
      if (taken > 0) {
        await recordAudit(tx, {
          workspaceId,
          action: 'credits.test_removed',
          data: { credits: taken },
        });
      }
      return taken;
    });
  }
  return removed;
}
