import 'server-only';
import type postgres from 'postgres';
import { randomId } from '../crypto';
import { recordAudit } from './audit';
import type { Reversal } from './orders';

type Tx = postgres.TransactionSql;

/**
 * Removes up to `upTo` unused credits from an account and writes one `void` ledger line for
 * what was removed. Credits held by a running eSign, and spent ones, are left alone, so the
 * balance never goes below zero. Once per `ref`. Returns how many were removed.
 */
export async function voidCredits(
  tx: Tx,
  input: { accountId: string; upTo: number; ref: string; reason: string },
): Promise<number> {
  const [row] = await tx<{ available: number }[]>`
    select available from app_esign_credits where account_id = ${input.accountId} for update`;
  const take = Math.min(row?.available ?? 0, Math.max(0, input.upTo));
  if (take < 1) return 0;
  const written = await tx`
    insert into app_esign_credit_ledger (id, account_id, kind, credits, ref, reason)
    values (${randomId('crl')}, ${input.accountId}, 'void', ${take}, ${input.ref}, ${input.reason})
    on conflict (account_id, kind, ref) do nothing
    returning id`;
  if (written.length !== 1) return 0;
  await tx`
    update app_esign_credits set available = available - ${take}, updated_at = now()
    where account_id = ${input.accountId}`;
  return take;
}

/** A refunded credits order loses the credits it added, as far as they are not used yet. */
export const reverseCredits: Reversal = async (tx, order) => {
  const credits = order.payload.credits;
  if (!order.accountId || typeof credits !== 'number') return;
  const taken = await voidCredits(tx, {
    accountId: order.accountId,
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
  const rows = await sql<{ account_id: string }[]>`
    select distinct l.account_id
    from app_esign_credit_ledger l
    join app_esign_credits c on c.account_id = l.account_id
    where l.kind = 'grant' and l.mode = 'test' and c.available > 0
    limit 200`;
  let removed = 0;
  for (const { account_id: accountId } of rows) {
    removed += await sql.begin(async (tx) => {
      await tx`select 1 from app_esign_credits where account_id = ${accountId} for update`;
      const [sums] = await tx<{ test: number; used: number; voided: number }[]>`
        select
          coalesce(sum(credits) filter (where kind = 'grant' and mode = 'test'), 0)::int as test,
          coalesce(sum(credits) filter (where kind = 'consume'), 0)::int as used,
          coalesce(sum(credits) filter (where kind = 'void' and reason = 'test'), 0)::int as voided
        from app_esign_credit_ledger where account_id = ${accountId}`;
      const left = (sums?.test ?? 0) - (sums?.used ?? 0) - (sums?.voided ?? 0);
      const taken = await voidCredits(tx, {
        accountId,
        upTo: left,
        ref: `test:${now.toISOString()}`,
        reason: 'test',
      });
      if (taken > 0) {
        await recordAudit(tx, {
          accountId,
          action: 'credits.test_removed',
          data: { credits: taken },
        });
      }
      return taken;
    });
  }
  return removed;
}
