import 'server-only';
import type { Mailer } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import { formatInr } from '@/lib/billing/money';
import { randomId } from '../crypto';

type Sql = postgres.Sql | postgres.TransactionSql;

/** Things about money the operator has to look at by hand. */
export type OperatorNoticeKind =
  | 'payment_unapplied'
  | 'payment_refunded'
  | 'refund_started'
  | 'payment_disputed'
  | 'dispute_lost';

export type NoticeData = Record<string, string | number | boolean | null>;

const MAX_ATTEMPTS = 8;

/**
 * Leaves a note for the operator, in the caller's transaction when there is one. The email
 * goes out from the background tick, so a mail failure never undoes what the note is about.
 */
export async function queueOperatorNotice(
  sql: Sql,
  input: {
    kind: OperatorNoticeKind;
    orderId?: string | null;
    accountId?: string | null;
    data?: NoticeData;
  },
): Promise<void> {
  await sql`
    insert into app_operator_notices (id, kind, order_id, account_id, data)
    values (
      ${randomId('note')}, ${input.kind}, ${input.orderId ?? null}, ${input.accountId ?? null},
      ${sql.json(input.data ?? {})}
    )`;
}

const SUBJECTS: Record<OperatorNoticeKind, string> = {
  payment_unapplied: 'A payment was received but not applied',
  payment_refunded: 'A payment was refunded',
  refund_started: 'A refund was started',
  payment_disputed: 'A payment is being disputed',
  dispute_lost: 'A payment dispute was lost',
};

const ADVICE: Record<OperatorNoticeKind, string> = {
  payment_unapplied:
    'Nothing was added to the account and no invoice was issued. Refund the payment from the Razorpay dashboard, or apply it by hand.',
  payment_refunded: 'What the payment bought was taken back where it had not been used yet.',
  refund_started:
    'Nothing was changed yet. What the payment bought is taken back once the refund is processed in full.',
  payment_disputed: 'Nothing was changed. Answer the dispute in the Razorpay dashboard.',
  dispute_lost: 'What the payment bought was taken back where it had not been used yet.',
};

interface NoticeRow {
  id: string;
  kind: OperatorNoticeKind;
  order_id: string | null;
  account_id: string | null;
  data: NoticeData;
  order_kind: string | null;
  total_paise: string | null;
  mode: 'test' | 'live' | null;
  razorpay_payment_id: string | null;
  owner_email: string | null;
}

function body(row: NoticeRow): string {
  const details = Object.entries(row.data)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`);
  return [
    `${SUBJECTS[row.kind]}.`,
    ADVICE[row.kind],
    ...(row.mode === 'test' ? ['This payment used test keys. No money moved.'] : []),
    '',
    ...(row.order_id ? [`Order: ${row.order_id} (${row.order_kind ?? 'unknown'})`] : []),
    ...(row.total_paise ? [`Amount: ${formatInr(Number(row.total_paise))}, GST included`] : []),
    ...(row.razorpay_payment_id ? [`Razorpay payment: ${row.razorpay_payment_id}`] : []),
    ...(row.account_id ? [`Account: ${row.owner_email ?? 'no owner'} (${row.account_id})`] : []),
    ...details,
  ].join('\n');
}

/**
 * Emails the operator the notes not sent yet. Each note is claimed first, so two processes
 * send one email; a failed send is tried again later. Without an operator address they wait.
 */
export async function sendOperatorNotices(
  sql: postgres.Sql,
  deps: { mailer: Mailer; operatorEmail: string | null; now: () => Date },
): Promise<number> {
  if (!deps.operatorEmail) return 0;
  const now = deps.now();
  const stale = new Date(now.getTime() - 5 * 60_000);
  const rows = await sql<NoticeRow[]>`
    with claimed as (
      update app_operator_notices
      set attempts = attempts + 1, claimed_at = ${now}
      where id in (
        select id from app_operator_notices
        where sent_at is null and attempts < ${MAX_ATTEMPTS}
          and (claimed_at is null or claimed_at < ${stale})
        order by created_at
        limit 20
        for update skip locked
      )
      returning *
    )
    select c.id, c.kind, c.order_id, c.account_id, c.data, o.kind as order_kind,
      o.total_paise, o.mode, o.razorpay_payment_id, u.email as owner_email
    from claimed c
    left join app_billing_orders o on o.id = c.order_id
    left join app_accounts a on a.id = c.account_id
    left join auth_users u on u.id = a.owner_user_id
    order by c.created_at`;
  let sent = 0;
  for (const row of rows) {
    try {
      await deps.mailer.send({
        to: deps.operatorEmail,
        subject: `${row.mode === 'test' ? '[Test] ' : ''}${SUBJECTS[row.kind]}`,
        text: body(row),
        meta: {
          kind: 'operator_notice',
          ...(row.account_id ? { accountId: row.account_id } : {}),
        },
      });
      await sql`
        update app_operator_notices set sent_at = ${deps.now()}, claimed_at = null
        where id = ${row.id}`;
      sent += 1;
    } catch (err) {
      await sql`update app_operator_notices set claimed_at = null where id = ${row.id}`;
      console.error('[billing] operator notice', err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
