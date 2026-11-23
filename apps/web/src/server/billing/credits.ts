import 'server-only';
import type postgres from 'postgres';
import { randomId } from '../crypto';

type Sql = postgres.Sql | postgres.TransactionSql;
type Tx = postgres.TransactionSql;

export interface CreditBalance {
  /** Credits that can start an eSign now. */
  available: number;
  /** Credits held by eSigns that have started and not finished. */
  reserved: number;
}

/** `void`: unused credits removed after a refund, or test credits removed on going live. */
export type CreditEntryKind = 'grant' | 'reserve' | 'consume' | 'release' | 'void';

export interface CreditEntry {
  id: string;
  kind: CreditEntryKind;
  credits: number;
  /** What the entry belongs to: an order id for a grant, an eSign session for the rest. */
  ref: string;
  reason: string | null;
  createdAt: string;
}

/** Runs `work` atomically: a new transaction, or a savepoint inside the caller's. */
function atomic<T>(sql: Sql, work: (tx: Tx) => Promise<T>): Promise<T> {
  const run = 'savepoint' in sql ? sql.savepoint(work) : sql.begin(work);
  return run as Promise<T>;
}

/** Writes a ledger line once per (account, kind, ref); false when it was already there. */
async function record(
  tx: Tx,
  entry: {
    accountId: string;
    kind: CreditEntryKind;
    credits: number;
    ref: string;
    reason?: string;
  },
): Promise<boolean> {
  const rows = await tx`
    insert into app_esign_credit_ledger (id, account_id, kind, credits, ref, reason)
    values (
      ${randomId('crl')}, ${entry.accountId}, ${entry.kind}, ${entry.credits}, ${entry.ref},
      ${entry.reason ?? null}
    )
    on conflict (account_id, kind, ref) do nothing
    returning id`;
  return rows.length === 1;
}

/** Locks the account's balance row for the rest of the transaction, creating it if needed. */
async function lockBalance(tx: Tx, accountId: string): Promise<CreditBalance> {
  await tx`
    insert into app_esign_credits (account_id) values (${accountId})
    on conflict (account_id) do nothing`;
  const [row] = await tx<CreditBalance[]>`
    select available, reserved from app_esign_credits
    where account_id = ${accountId} for update`;
  return row!;
}

async function kindsFor(tx: Tx, accountId: string, ref: string): Promise<Set<CreditEntryKind>> {
  const rows = await tx<{ kind: CreditEntryKind }[]>`
    select kind from app_esign_credit_ledger
    where account_id = ${accountId} and ref = ${ref}`;
  return new Set(rows.map((row) => row.kind));
}

export async function creditBalance(sql: Sql, accountId: string): Promise<CreditBalance> {
  const [row] = await sql<CreditBalance[]>`
    select available, reserved from app_esign_credits where account_id = ${accountId}`;
  return row ?? { available: 0, reserved: 0 };
}

/**
 * Adds bought credits to an account, once per `ref` (the order). Returns false when that
 * grant was already made, so a repeated fulfilment adds nothing.
 */
export async function grantCredits(
  sql: Sql,
  input: { accountId: string; credits: number; ref: string; reason?: string },
): Promise<boolean> {
  if (!Number.isInteger(input.credits) || input.credits < 1) {
    throw new Error('credits must be a whole number above zero');
  }
  return atomic(sql, async (tx) => {
    await lockBalance(tx, input.accountId);
    if (!(await record(tx, { ...input, kind: 'grant' }))) return false;
    await tx`
      update app_esign_credits
      set available = available + ${input.credits}, updated_at = now()
      where account_id = ${input.accountId}`;
    await settleOwedEsigns(tx, input.accountId);
    return true;
  });
}

/** eSigns that were signed when the account had no credit left to pay for them. */
export async function owedEsigns(sql: Sql, accountId: string): Promise<number> {
  const [row] = await sql<{ owed: number }[]>`
    select count(*)::int as owed from app_esign_usage
    where account_id = ${accountId} and unbilled and owed_settled_at is null`;
  return row?.owed ?? 0;
}

/**
 * Pays for owed eSigns, oldest first, with whatever credits the account has now. Each one
 * is a reserve and a consume in the ledger under `<ref>:late`. Returns how many are still
 * owed. New credits go here before they can start another eSign.
 */
export async function settleOwedEsigns(sql: Sql, accountId: string): Promise<number> {
  if ((await owedEsigns(sql, accountId)) === 0) return 0;
  return atomic(sql, async (tx) => {
    await lockBalance(tx, accountId);
    const owed = await tx<{ ref: string }[]>`
      select ref from app_esign_usage
      where account_id = ${accountId} and unbilled and owed_settled_at is null
      order by started_at, ref
      for update`;
    let left = owed.length;
    for (const { ref } of owed) {
      const hold = { accountId, ref: `${ref}:late` };
      if (!(await reserveCredit(tx, hold))) break;
      await consumeCredit(tx, hold);
      await tx`update app_esign_usage set owed_settled_at = now() where ref = ${ref}`;
      left -= 1;
    }
    return left;
  });
}

/**
 * Holds one credit for an eSign that is about to start. False when the account has none
 * left; the balance never goes below zero. Asking again for the same `ref` changes nothing and
 * answers whether that hold still stands (true while held or consumed, false once released).
 */
export async function reserveCredit(
  sql: Sql,
  input: { accountId: string; ref: string },
): Promise<boolean> {
  return atomic(sql, async (tx) => {
    const balance = await lockBalance(tx, input.accountId);
    const kinds = await kindsFor(tx, input.accountId, input.ref);
    if (kinds.has('reserve')) return !kinds.has('release');
    if (balance.available < 1) return false;
    await record(tx, { ...input, kind: 'reserve', credits: 1 });
    await tx`
      update app_esign_credits
      set available = available - 1, reserved = reserved + 1, updated_at = now()
      where account_id = ${input.accountId}`;
    return true;
  });
}

async function settle(
  sql: Sql,
  input: { accountId: string; ref: string },
  kind: 'consume' | 'release',
): Promise<boolean> {
  return atomic(sql, async (tx) => {
    await lockBalance(tx, input.accountId);
    const kinds = await kindsFor(tx, input.accountId, input.ref);
    if (!kinds.has('reserve') || kinds.has('consume') || kinds.has('release')) return false;
    await record(tx, { ...input, kind, credits: 1 });
    await tx`
      update app_esign_credits
      set reserved = reserved - 1,
          available = available + ${kind === 'release' ? 1 : 0},
          updated_at = now()
      where account_id = ${input.accountId}`;
    return true;
  });
}

/**
 * Spends the credit held for `ref`: the eSign succeeded. False, and nothing changes, when
 * there is no open hold for `ref` (never reserved, or already consumed or released).
 */
export const consumeCredit = (sql: Sql, input: { accountId: string; ref: string }) =>
  settle(sql, input, 'consume');

/**
 * Gives the credit held for `ref` back: the eSign failed, was abandoned or expired. False, and
 * nothing changes, when there is no open hold for `ref`.
 */
export const releaseCredit = (sql: Sql, input: { accountId: string; ref: string }) =>
  settle(sql, input, 'release');

/** The newest ledger lines of an account. */
export async function creditHistory(
  sql: Sql,
  accountId: string,
  limit = 100,
): Promise<CreditEntry[]> {
  const rows = await sql<
    {
      id: string;
      kind: CreditEntryKind;
      credits: number;
      ref: string;
      reason: string | null;
      created_at: Date;
    }[]
  >`
    select id, kind, credits, ref, reason, created_at
    from app_esign_credit_ledger
    where account_id = ${accountId}
    order by created_at desc, id desc
    limit ${Math.min(Math.max(limit, 1), 500)}`;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    credits: row.credits,
    ref: row.ref,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }));
}
