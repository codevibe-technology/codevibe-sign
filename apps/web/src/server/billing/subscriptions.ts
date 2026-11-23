import 'server-only';
import type postgres from 'postgres';
import { formatInr, type Paise } from '@/lib/billing/money';
import {
  RENEWAL_WINDOW_DAYS,
  TERM_LABELS,
  daysBetween,
  formatPeriod,
  formatTermDay,
  isTerm,
  proratedPrice,
  reminderStage,
  termEnd,
  termPrice,
  type Term,
} from '@/lib/billing/terms';
import { isPlan, type Plan } from '@/lib/plans';
import { randomId } from '../crypto';
import { AppError } from '../errors';
import { recordAudit } from './audit';
import { paymentsConfigured, type BillingConfig } from './config';
import { BILLING_DETAILS_FIELD } from './credit-orders';
import { getBillingDetails } from './details';
import {
  createOrder,
  type BillingDeps,
  type BillingOrder,
  type CheckoutSession,
  type Fulfilment,
  type Reversal,
} from './orders';
import { countSeats } from '../plans';

type Sql = postgres.Sql | postgres.TransactionSql;
type Tx = postgres.TransactionSql;

export type SubscriptionStatus = 'active' | 'grace' | 'ended';

export interface Subscription {
  workspaceId: string;
  term: Term;
  /** Extra members paid for in the current term. */
  seats: number;
  /** Extra members the next term will be charged for. */
  renewalSeats: number;
  periodStart: Date;
  periodEnd: Date;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: Date | null;
}

interface Row {
  workspace_id: string;
  term: string;
  seats: number;
  renewal_seats: number;
  period_start: Date;
  period_end: Date;
  status: SubscriptionStatus;
  cancel_at_period_end: boolean;
  grace_ends_at: Date | null;
  last_reminder: string | null;
  /** The order that paid for the current term. */
  order_id: string | null;
  prior: Prior | null;
}

const toSubscription = (row: Row): Subscription => ({
  workspaceId: row.workspace_id,
  term: isTerm(row.term) ? row.term : 'month',
  seats: row.seats,
  renewalSeats: row.renewal_seats,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  status: row.status,
  cancelAtPeriodEnd: row.cancel_at_period_end,
  graceEndsAt: row.grace_ends_at,
});

export async function getSubscription(sql: Sql, workspaceId: string): Promise<Subscription | null> {
  const [row] = await sql<Row[]>`
    select * from app_subscriptions where workspace_id = ${workspaceId}`;
  return row ? toSubscription(row) : null;
}

/** Most extra members one workspace can pay for. */
export const MAX_EXTRA_SEATS = 500;

const DAY_MS = 86_400_000;

/** A term can be paid for again in its last days and while the workspace is in grace. */
export function canRenew(subscription: Subscription, now: Date): boolean {
  if (subscription.status === 'grace') return true;
  if (subscription.status !== 'active') return false;
  return subscription.periodEnd.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * DAY_MS;
}

interface PlanState {
  plan: Plan;
  /** Who last set the plan: the operator by hand, or a payment. */
  source: 'operator' | 'billing';
}

async function planOf(sql: Sql, workspaceId: string): Promise<PlanState> {
  const [row] = await sql<{ plan: string; plan_source: PlanState['source'] }[]>`
    select plan, plan_source from app_workspaces where id = ${workspaceId}`;
  if (!row) throw new AppError('NOT_FOUND', 'Workspace not found');
  return { plan: isPlan(row.plan) ? row.plan : 'free', source: row.plan_source };
}

/**
 * A paid plan the operator set by hand is not sold, renewed, changed or ended here, whatever
 * subscription the workspace once had.
 */
const operatorManaged = (state: PlanState) => state.plan !== 'free' && state.source !== 'billing';

/**
 * The fewest extra members a term can be paid for: the people already in the workspace, open
 * invitations included, beyond those the plan includes.
 */
async function seatFloor(sql: Sql, config: BillingConfig, workspaceId: string, now: Date) {
  const { members, invited } = await countSeats(sql, workspaceId, now);
  const people = members + invited;
  return { people, floor: Math.max(0, people - config.cloud.includedMembers) };
}

async function assertSeatsCover(
  sql: Sql,
  config: BillingConfig,
  input: { workspaceId: string; seats: number },
  now: Date,
): Promise<void> {
  const { people, floor } = await seatFloor(sql, config, input.workspaceId, now);
  if (input.seats >= floor) return;
  const remove = floor - input.seats;
  throw new AppError(
    'VALIDATION',
    `This workspace has ${people} members and open invitations, and ${config.cloud.includedMembers} are included, so it needs at least ${floor} extra ${floor === 1 ? 'member' : 'members'}. To pay for ${input.seats}, first remove ${remove} ${remove === 1 ? 'person' : 'people'} or withdraw their invitations.`,
    'seats',
  );
}

const MANAGED_MESSAGE =
  'The plan of this workspace is managed by our team. Write to us to change it.';

async function buyerOf(sql: Sql, workspaceId: string) {
  const buyer = await getBillingDetails(sql, workspaceId);
  if (!buyer) {
    throw new AppError(
      'VALIDATION',
      'Add your billing details first. They are printed on the tax invoice.',
      BILLING_DETAILS_FIELD,
    );
  }
  return buyer;
}

function assertPayments(config: BillingConfig) {
  if (!paymentsConfigured(config)) {
    throw new AppError('CONFLICT', 'Payments are not available here yet.');
  }
}

const seatsLine = (seats: number) => `Extra members × ${seats}`;

export interface TermQuote {
  term: Term;
  seats: number;
  period: { start: Date; end: Date };
  lines: { description: string; quantity: number; unitPaise: Paise }[];
  /** Before GST. */
  taxablePaise: Paise;
}

/**
 * What a term costs and which days it covers. A first term, or one after the subscription
 * ended, starts now; a renewal starts where the paid term ends, so paying early or in the
 * grace days never shifts the dates.
 */
export function quoteTerm(
  config: BillingConfig,
  subscription: Subscription | null,
  input: { term: Term; seats: number },
  now: Date,
): TermQuote {
  const { cloud } = config;
  const renewing = subscription !== null && subscription.status !== 'ended';
  const start = renewing ? subscription.periodEnd : now;
  const end = termEnd(start, input.term);
  const label = `${TERM_LABELS[input.term]} (${formatPeriod(start, end)})`;
  const lines = [
    {
      description: `Codevibe Sign Cloud, ${label}`,
      quantity: 1,
      unitPaise: termPrice(cloud.pricePaise, input.term, cloud.annualMonths),
    },
    ...(input.seats > 0
      ? [
          {
            description: `${seatsLine(input.seats)}, ${label}`,
            quantity: input.seats,
            unitPaise: termPrice(cloud.extraMemberPaise, input.term, cloud.annualMonths),
          },
        ]
      : []),
  ];
  return {
    term: input.term,
    seats: input.seats,
    period: { start, end },
    lines,
    taxablePaise: lines.reduce((sum, line) => sum + line.quantity * line.unitPaise, 0),
  };
}

/**
 * Opens the order for a first Cloud term or the next one. Paying it moves the workspace to
 * Cloud at once, or extends the term it already has.
 */
export async function createSubscriptionOrder(
  sql: postgres.Sql,
  deps: BillingDeps,
  input: {
    workspaceId: string;
    userId: string;
    term: Term;
    /** Extra members for the term. Defaults to what the workspace has set for its renewal. */
    seats?: number | undefined;
    ip?: string | null;
  },
): Promise<{ order: BillingOrder; checkout: CheckoutSession }> {
  assertPayments(deps.config);
  const now = deps.now();
  const [plan, subscription] = await Promise.all([
    planOf(sql, input.workspaceId),
    getSubscription(sql, input.workspaceId),
  ]);
  if (operatorManaged(plan)) throw new AppError('CONFLICT', MANAGED_MESSAGE);
  if (subscription?.status === 'active' && !canRenew(subscription, now)) {
    const from = new Date(subscription.periodEnd.getTime() - RENEWAL_WINDOW_DAYS * DAY_MS);
    throw new AppError(
      'CONFLICT',
      `This workspace is paid up to ${formatTermDay(subscription.periodEnd)}. You can pay for the next term from ${formatTermDay(from)}.`,
    );
  }
  const live = subscription && subscription.status !== 'ended' ? subscription : null;
  const seats = input.seats ?? live?.renewalSeats ?? 0;
  if (!Number.isInteger(seats) || seats < 0 || seats > MAX_EXTRA_SEATS) {
    throw new AppError(
      'VALIDATION',
      `Extra members must be a whole number from 0 to ${MAX_EXTRA_SEATS}`,
      'seats',
    );
  }
  await assertSeatsCover(sql, deps.config, { workspaceId: input.workspaceId, seats }, now);
  const buyer = await buyerOf(sql, input.workspaceId);
  const quote = quoteTerm(deps.config, live, { term: input.term, seats }, now);
  return createOrder(sql, deps, {
    workspaceId: input.workspaceId,
    kind: 'cloud_subscription',
    lines: quote.lines,
    // `from` ties a renewal to the term it continues, so it cannot extend another one.
    payload: {
      term: input.term,
      seats,
      renewal: live !== null,
      from: live ? live.periodEnd.toISOString() : null,
    },
    buyer,
    createdBy: input.userId,
    summary: `Codevibe Sign Cloud, ${TERM_LABELS[input.term]}`,
    ip: input.ip ?? null,
  });
}

/** What adding members for the rest of the current term costs, before GST. */
export function quoteSeats(
  config: BillingConfig,
  subscription: Subscription,
  add: number,
  now: Date,
): { unitPaise: Paise; taxablePaise: Paise; daysLeft: number } {
  const full = termPrice(
    config.cloud.extraMemberPaise,
    subscription.term,
    config.cloud.annualMonths,
  );
  const unitPaise = proratedPrice(
    full,
    { start: subscription.periodStart, end: subscription.periodEnd },
    now,
  );
  return {
    unitPaise,
    taxablePaise: unitPaise * add,
    daysLeft: daysBetween(now, subscription.periodEnd),
  };
}

/**
 * Opens the order for more members in the middle of a term, charged for the days that are
 * left. They can be invited as soon as it is paid, and the next term includes them.
 */
export async function createSeatsOrder(
  sql: postgres.Sql,
  deps: BillingDeps,
  input: { workspaceId: string; userId: string; add: number; ip?: string | null },
): Promise<{ order: BillingOrder; checkout: CheckoutSession }> {
  assertPayments(deps.config);
  const now = deps.now();
  const [plan, subscription] = await Promise.all([
    planOf(sql, input.workspaceId),
    getSubscription(sql, input.workspaceId),
  ]);
  if (operatorManaged(plan)) throw new AppError('CONFLICT', MANAGED_MESSAGE);
  if (!subscription || subscription.status !== 'active') {
    throw new AppError(
      'CONFLICT',
      subscription?.status === 'grace'
        ? 'Pay for the next term first. Extra members can be added once the workspace is paid up.'
        : 'Extra members are part of the Cloud plan. Upgrade to Cloud first.',
    );
  }
  if (
    !Number.isInteger(input.add) ||
    input.add < 1 ||
    subscription.seats + input.add > MAX_EXTRA_SEATS
  ) {
    throw new AppError(
      'VALIDATION',
      `Add a whole number of members, up to ${MAX_EXTRA_SEATS} extra in all`,
      'add',
    );
  }
  const quote = quoteSeats(deps.config, subscription, input.add, now);
  if (quote.unitPaise < 1) {
    throw new AppError(
      'CONFLICT',
      'This term ends today. Pay for the next term with the members you need.',
    );
  }
  const buyer = await buyerOf(sql, input.workspaceId);
  const until = formatTermDay(new Date(subscription.periodEnd.getTime() - DAY_MS));
  return createOrder(sql, deps, {
    workspaceId: input.workspaceId,
    kind: 'extra_seats',
    lines: [
      {
        description: `${seatsLine(input.add)}, ${quote.daysLeft} days to ${until}`,
        quantity: input.add,
        unitPaise: quote.unitPaise,
      },
    ],
    // The price is for the days left of this term only, so the order is good for no other.
    payload: {
      add: input.add,
      periodEnd: subscription.periodEnd.toISOString(),
      seatsBefore: subscription.seats,
    },
    buyer,
    createdBy: input.userId,
    summary: `${input.add} extra ${input.add === 1 ? 'member' : 'members'}`,
    ip: input.ip ?? null,
  });
}

async function lockSubscription(tx: Tx, workspaceId: string): Promise<Row | null> {
  // The workspace row is the lock every plan check takes, so seats and plan change together.
  await tx`select 1 from app_workspaces where id = ${workspaceId} for update`;
  const [row] = await tx<Row[]>`
    select * from app_subscriptions where workspace_id = ${workspaceId} for update`;
  return row ?? null;
}

async function movePlan(tx: Tx, workspaceId: string, to: Plan, seats: number, by: string) {
  const [row] = await tx<{ plan: string }[]>`
    select plan from app_workspaces where id = ${workspaceId}`;
  if (!row) return;
  await tx`
    update app_workspaces
    set plan = ${to}, extra_seats = ${seats}, plan_source = 'billing', updated_at = now()
    where id = ${workspaceId}`;
  if (row.plan !== to) {
    await tx`
      insert into app_plan_changes (id, workspace_id, from_plan, to_plan, changed_by)
      values (${randomId('plan')}, ${workspaceId}, ${row.plan}, ${to}, ${by})`;
  }
}

/** What the subscription looked like before an order changed it, to put back on a refund. */
interface Prior {
  term: string;
  seats: number;
  renewalSeats: number;
  periodStart: string;
  periodEnd: string;
}

/**
 * Paying for a term starts or extends the subscription and puts the workspace on Cloud. An
 * order delivers nothing when it no longer fits: a first term for a workspace that already
 * has a running one, a renewal of a term that is not the current one, or a workspace whose
 * plan the operator has since taken over.
 */
export const fulfilSubscription: Fulfilment = async (tx, order, { now }) => {
  const { term, seats, from } = order.payload;
  if (!order.workspaceId || !isTerm(term) || typeof seats !== 'number') {
    throw new Error(`Subscription order ${order.id} is incomplete`);
  }
  const current = await lockSubscription(tx, order.workspaceId);
  if (operatorManaged(await planOf(tx, order.workspaceId))) return { unapplied: 'plan_managed' };
  const renewing = current !== null && current.status !== 'ended';
  const quotedFrom = typeof from === 'string' ? from : null;
  if ((renewing ? current.period_end.toISOString() : null) !== quotedFrom) {
    return { unapplied: 'term_changed' };
  }
  const start = renewing ? current.period_end : now;
  const end = termEnd(start, term);
  const prior: Prior | null = renewing
    ? {
        term: current.term,
        seats: current.seats,
        renewalSeats: current.renewal_seats,
        periodStart: current.period_start.toISOString(),
        periodEnd: current.period_end.toISOString(),
      }
    : null;
  await tx`
    insert into app_subscriptions (
      workspace_id, term, seats, renewal_seats, period_start, period_end, status, order_id, prior
    ) values (
      ${order.workspaceId}, ${term}, ${seats}, ${seats}, ${start}, ${end}, 'active', ${order.id},
      ${prior ? tx.json(prior as never) : null}
    )
    on conflict (workspace_id) do update set
      term = excluded.term, seats = excluded.seats, renewal_seats = excluded.renewal_seats,
      period_start = excluded.period_start, period_end = excluded.period_end, status = 'active',
      cancel_at_period_end = false, grace_ends_at = null, last_reminder = null,
      order_id = excluded.order_id, prior = excluded.prior, updated_at = ${now}`;
  await movePlan(tx, order.workspaceId, 'cloud', seats, order.createdBy ?? 'billing');
  await recordAudit(tx, {
    workspaceId: order.workspaceId,
    actorId: order.createdBy,
    action: renewing ? 'subscription.renewed' : 'subscription.started',
    target: order.id,
    data: { term, seats, periodStart: start.toISOString(), periodEnd: end.toISOString() },
  });
};

/**
 * Paying for extra members adds them to the term in progress and to the next one. The price
 * was for the days left of one term, so the order adds nothing to any other term, and nothing
 * beyond the most a workspace can have.
 */
export const fulfilSeats: Fulfilment = async (tx, order, { now }) => {
  const { add, periodEnd } = order.payload;
  if (!order.workspaceId || typeof add !== 'number' || add < 1) {
    throw new Error(`Seats order ${order.id} is incomplete`);
  }
  const current = await lockSubscription(tx, order.workspaceId);
  const unapplied = (reason: 'term_changed' | 'seat_limit' | 'plan_managed') =>
    recordAudit(tx, {
      workspaceId: order.workspaceId,
      actorId: order.createdBy,
      action: 'subscription.seats_unapplied',
      target: order.id,
      data: { added: add, reason },
    }).then(() => ({ unapplied: reason }));
  if (operatorManaged(await planOf(tx, order.workspaceId))) return unapplied('plan_managed');
  if (
    !current ||
    current.status !== 'active' ||
    current.period_end.toISOString() !== periodEnd ||
    current.period_end.getTime() <= now.getTime()
  ) {
    return unapplied('term_changed');
  }
  const seats = current.seats + add;
  if (seats > MAX_EXTRA_SEATS) return unapplied('seat_limit');
  await tx`
    update app_subscriptions
    set seats = ${seats}, renewal_seats = least(renewal_seats + ${add}, ${MAX_EXTRA_SEATS}),
      updated_at = ${now}
    where workspace_id = ${order.workspaceId}`;
  await tx`
    update app_workspaces set extra_seats = ${seats}, updated_at = now()
    where id = ${order.workspaceId} and plan = 'cloud'`;
  await recordAudit(tx, {
    workspaceId: order.workspaceId,
    actorId: order.createdBy,
    action: 'subscription.seats_changed',
    target: order.id,
    data: { added: add, seats },
  });
};

/**
 * A refunded term is taken back when it is still the workspace's latest: a renewal returns
 * the subscription to the term before it, if that one is still running; otherwise the
 * subscription ends and the workspace moves to Free, with nothing deleted.
 */
export const reverseSubscription: Reversal = async (tx, order, { now }) => {
  if (!order.workspaceId) return;
  const row = await lockSubscription(tx, order.workspaceId);
  if (!row || row.status === 'ended' || row.order_id !== order.id) {
    return { subscription: 'unchanged' };
  }
  const prior = row.prior;
  if (prior && new Date(prior.periodEnd).getTime() > now.getTime()) {
    await tx`
      update app_subscriptions
      set term = ${prior.term}, seats = ${prior.seats}, renewal_seats = ${prior.renewalSeats},
        period_start = ${new Date(prior.periodStart)}, period_end = ${new Date(prior.periodEnd)},
        status = 'active', grace_ends_at = null, last_reminder = null, order_id = null,
        prior = null, updated_at = ${now}
      where workspace_id = ${order.workspaceId}`;
    await tx`
      update app_workspaces set extra_seats = ${prior.seats}, updated_at = now()
      where id = ${order.workspaceId} and plan = 'cloud' and plan_source = 'billing'`;
    await recordAudit(tx, {
      workspaceId: order.workspaceId,
      action: 'subscription.renewal_reversed',
      target: order.id,
      data: { periodEnd: prior.periodEnd },
    });
    return { subscription: 'previous term restored' };
  }
  await endSubscription(tx, row, now, 'refunded');
  return { subscription: 'ended, workspace on Free' };
};

/** Refunded extra members leave the term they were bought for, if it is still running. */
export const reverseSeats: Reversal = async (tx, order, { now }) => {
  const { add, periodEnd } = order.payload;
  if (!order.workspaceId || typeof add !== 'number') return;
  const current = await lockSubscription(tx, order.workspaceId);
  if (!current || current.status === 'ended' || current.period_end.toISOString() !== periodEnd) {
    return { seats: 'unchanged' };
  }
  const seats = Math.max(0, current.seats - add);
  await tx`
    update app_subscriptions
    set seats = ${seats}, renewal_seats = greatest(renewal_seats - ${add}, 0), updated_at = ${now}
    where workspace_id = ${order.workspaceId}`;
  await tx`
    update app_workspaces set extra_seats = ${seats}, updated_at = now()
    where id = ${order.workspaceId} and plan = 'cloud' and plan_source = 'billing'`;
  await recordAudit(tx, {
    workspaceId: order.workspaceId,
    action: 'subscription.seats_changed',
    target: order.id,
    data: { removed: add, seats, reason: 'refunded' },
  });
  return { seats: `${add} removed, ${seats} left` };
};

/**
 * Says whether the subscription stops at the end of the paid term. Nothing changes until
 * then, and nothing is refunded.
 */
export async function scheduleCancel(
  sql: postgres.Sql,
  input: { workspaceId: string; userId: string; cancel: boolean },
): Promise<Subscription> {
  return sql.begin(async (tx) => {
    const current = await lockSubscription(tx, input.workspaceId);
    if (!current || current.status !== 'active') {
      throw new AppError('CONFLICT', 'There is no running Cloud term to change.');
    }
    const [row] = await tx<Row[]>`
      update app_subscriptions set cancel_at_period_end = ${input.cancel}, updated_at = now()
      where workspace_id = ${input.workspaceId}
      returning *`;
    if (current.cancel_at_period_end !== input.cancel) {
      await recordAudit(tx, {
        workspaceId: input.workspaceId,
        actorId: input.userId,
        action: input.cancel ? 'subscription.cancel_scheduled' : 'subscription.cancel_undone',
        data: { periodEnd: current.period_end.toISOString() },
      });
    }
    return toSubscription(row!);
  });
}

/** Sets how many extra members the next term is charged for. The current term keeps its own. */
export async function setRenewalSeats(
  sql: postgres.Sql,
  input: { workspaceId: string; userId: string; seats: number; config: BillingConfig; now?: Date },
): Promise<Subscription> {
  if (!Number.isInteger(input.seats) || input.seats < 0 || input.seats > MAX_EXTRA_SEATS) {
    throw new AppError(
      'VALIDATION',
      `Extra members must be a whole number from 0 to ${MAX_EXTRA_SEATS}`,
      'seats',
    );
  }
  return sql.begin(async (tx) => {
    const current = await lockSubscription(tx, input.workspaceId);
    if (!current || current.status === 'ended') {
      throw new AppError('CONFLICT', 'There is no running Cloud term to change.');
    }
    await assertSeatsCover(tx, input.config, input, input.now ?? new Date());
    const [row] = await tx<Row[]>`
      update app_subscriptions set renewal_seats = ${input.seats}, updated_at = now()
      where workspace_id = ${input.workspaceId}
      returning *`;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorId: input.userId,
      action: 'subscription.seats_changed',
      data: { renewalSeats: input.seats, seats: current.seats },
    });
    return toSubscription(row!);
  });
}

async function recipientsOf(
  sql: Sql,
  workspaceId: string,
): Promise<{ to: string[]; name: string }> {
  const [workspace] = await sql<{ name: string }[]>`
    select name from app_workspaces where id = ${workspaceId}`;
  const billing = await getBillingDetails(sql, workspaceId);
  const owners = await sql<{ email: string }[]>`
    select u.email from app_members m join auth_users u on u.id = m.user_id
    where m.workspace_id = ${workspaceId} and m.role = 'owner'`;
  const to = [...new Set([...(billing ? [billing.email] : []), ...owners.map((o) => o.email)])];
  return { to, name: workspace?.name ?? 'your workspace' };
}

type Notice = 'subscription_reminder' | 'subscription_grace' | 'subscription_ended';

async function notify(
  sql: Sql,
  deps: BillingDeps,
  workspaceId: string,
  kind: Notice,
  message: { subject: string; lines: string[] },
): Promise<void> {
  const { to } = await recipientsOf(sql, workspaceId);
  const seller = deps.config.seller?.name ?? 'Codevibe Sign';
  for (const address of to) {
    await deps.mailer.send({
      to: address,
      fromName: seller,
      subject: message.subject,
      text: ['Hello,', '', ...message.lines, '', seller].join('\n'),
      meta: { kind, workspaceId },
    });
  }
}

const planPage = 'Open Settings, then Plan and usage, in your workspace to pay for the next term.';

async function remind(sql: postgres.Sql, deps: BillingDeps, row: Row, now: Date): Promise<boolean> {
  const stage = reminderStage(daysBetween(now, row.period_end));
  if (stage === null) return false;
  const key = `${row.period_end.toISOString()}:${stage}`;
  const [claimed] = await sql`
    update app_subscriptions set last_reminder = ${key}
    where workspace_id = ${row.workspace_id} and status = 'active'
      and last_reminder is distinct from ${key}
    returning workspace_id`;
  if (!claimed) return false;
  const { name } = await recipientsOf(sql, row.workspace_id);
  const total = quoteTerm(
    deps.config,
    toSubscription(row),
    { term: isTerm(row.term) ? row.term : 'month', seats: row.renewal_seats },
    now,
  ).taxablePaise;
  try {
    await notify(sql, deps, row.workspace_id, 'subscription_reminder', {
      subject: `Codevibe Sign Cloud for ${name} ends on ${formatTermDay(row.period_end)}`,
      lines: [
        `The Cloud term of ${name} ends on ${formatTermDay(row.period_end)}, in ${stage} ${stage === 1 ? 'day' : 'days'}.`,
        `The next term is ${formatInr(total)} plus GST. ${planPage}`,
        '',
        `If it is not paid, the workspace has ${deps.config.cloud.graceDays} more days on Cloud and then moves to the Free plan. Nothing is deleted.`,
      ],
    });
  } catch (err) {
    await sql`
      update app_subscriptions set last_reminder = ${row.last_reminder}
      where workspace_id = ${row.workspace_id} and last_reminder = ${key}`;
    throw err;
  }
  return true;
}

async function endSubscription(
  tx: Tx,
  row: Row,
  now: Date,
  reason: 'cancelled' | 'unpaid' | 'refunded',
): Promise<void> {
  await tx`
    update app_subscriptions
    set status = 'ended', grace_ends_at = null, seats = 0, updated_at = ${now}
    where workspace_id = ${row.workspace_id}`;
  const state = await planOf(tx, row.workspace_id);
  // A plan the operator has since set by hand is left as it is.
  if (state.plan === 'cloud' && state.source === 'billing') {
    await movePlan(tx, row.workspace_id, 'free', 0, 'billing');
  }
  await recordAudit(tx, {
    workspaceId: row.workspace_id,
    action: 'subscription.ended',
    data: { reason, periodEnd: row.period_end.toISOString() },
  });
}

export interface SubscriptionTickResult {
  reminded: number;
  graceStarted: number;
  ended: number;
}

/**
 * Moves subscriptions along with the clock: reminders before a term ends, the grace days
 * after it, and the fall back to the Free plan when they are over. Each step is a guarded
 * update, so running it from several processes or twice in a row changes nothing more.
 * Workspaces whose plan the operator set have no subscription and are never touched.
 */
export async function runSubscriptionTick(
  sql: postgres.Sql,
  deps: BillingDeps,
  now: Date = deps.now(),
): Promise<SubscriptionTickResult> {
  const result: SubscriptionTickResult = { reminded: 0, graceStarted: 0, ended: 0 };
  const horizon = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS);
  const rows = await sql<Row[]>`
    select * from app_subscriptions
    where status <> 'ended' and period_end <= ${horizon}
    order by period_end
    limit 200`;
  const report = (what: string) => (err: unknown) =>
    console.error(`[billing] ${what}`, err instanceof Error ? err.message : err);

  for (const row of rows) {
    const over = row.period_end.getTime() <= now.getTime();
    if (row.status === 'active' && !over) {
      if (row.cancel_at_period_end) continue;
      if (await remind(sql, deps, row, now).catch(report('reminder'))) result.reminded += 1;
      continue;
    }
    if (row.status === 'active' && row.cancel_at_period_end) {
      const ended = await sql.begin(async (tx) => {
        const current = await lockSubscription(tx, row.workspace_id);
        if (
          !current ||
          current.status !== 'active' ||
          !current.cancel_at_period_end ||
          current.period_end.getTime() > now.getTime()
        ) {
          return false;
        }
        await endSubscription(tx, current, now, 'cancelled');
        return true;
      });
      if (ended) {
        result.ended += 1;
        await notify(sql, deps, row.workspace_id, 'subscription_ended', {
          subject: 'Your Codevibe Sign workspace is now on the Free plan',
          lines: [
            'The Cloud term ended and was not renewed, as you asked.',
            'Your documents, templates and members are all still there. The Free plan limits apply to anything new.',
          ],
        }).catch(report('ended notice'));
      }
      continue;
    }
    if (row.status === 'active') {
      const graceEnds = new Date(row.period_end.getTime() + deps.config.cloud.graceDays * DAY_MS);
      const [started] = await sql`
        update app_subscriptions
        set status = 'grace', grace_ends_at = ${graceEnds}, updated_at = ${now}
        where workspace_id = ${row.workspace_id} and status = 'active'
          and cancel_at_period_end = false and period_end = ${row.period_end}
        returning workspace_id`;
      if (!started) continue;
      result.graceStarted += 1;
      await recordAudit(sql, {
        workspaceId: row.workspace_id,
        action: 'subscription.grace_started',
        data: { graceEndsAt: graceEnds.toISOString() },
      });
      await notify(sql, deps, row.workspace_id, 'subscription_grace', {
        subject: 'Your Codevibe Sign Cloud term has ended',
        lines: [
          `The Cloud term ended on ${formatTermDay(row.period_end)} and the next one is not paid yet.`,
          `Everything keeps working until ${formatTermDay(graceEnds)}. ${planPage}`,
          'After that the workspace moves to the Free plan. Nothing is deleted.',
        ],
      }).catch(report('grace notice'));
      continue;
    }
    if (row.status === 'grace' && row.grace_ends_at && row.grace_ends_at <= now) {
      const ended = await sql.begin(async (tx) => {
        const current = await lockSubscription(tx, row.workspace_id);
        if (
          !current ||
          current.status !== 'grace' ||
          !current.grace_ends_at ||
          current.grace_ends_at.getTime() > now.getTime()
        ) {
          return false;
        }
        await endSubscription(tx, current, now, 'unpaid');
        return true;
      });
      if (ended) {
        result.ended += 1;
        await notify(sql, deps, row.workspace_id, 'subscription_ended', {
          subject: 'Your Codevibe Sign workspace is now on the Free plan',
          lines: [
            'The Cloud term was not renewed, so the workspace moved to the Free plan.',
            'Your documents, templates and members are all still there. The Free plan limits apply to anything new, and webhooks are paused.',
            'You can move back to Cloud at any time from Settings, Plan and usage.',
          ],
        }).catch(report('ended notice'));
      }
    }
  }
  return result;
}

export interface SubscriptionView {
  /** `managed`: a paid plan the operator set, with nothing to pay here. */
  state: 'none' | 'active' | 'grace' | 'ended' | 'managed';
  term: Term | null;
  seats: number;
  renewalSeats: number;
  periodEnd: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canRenew: boolean;
  /** When paying for the next term opens, for a term not yet in its last days. */
  renewFrom: string | null;
}

export interface PlanPrices {
  monthPaise: Paise;
  yearPaise: Paise;
  seatMonthPaise: Paise;
  seatYearPaise: Paise;
  includedMembers: number;
  annualMonths: number;
  gstPercent: number;
  graceDays: number;
}

export const planPrices = (config: BillingConfig): PlanPrices => ({
  monthPaise: termPrice(config.cloud.pricePaise, 'month', config.cloud.annualMonths),
  yearPaise: termPrice(config.cloud.pricePaise, 'year', config.cloud.annualMonths),
  seatMonthPaise: termPrice(config.cloud.extraMemberPaise, 'month', config.cloud.annualMonths),
  seatYearPaise: termPrice(config.cloud.extraMemberPaise, 'year', config.cloud.annualMonths),
  includedMembers: config.cloud.includedMembers,
  annualMonths: config.cloud.annualMonths,
  gstPercent: config.gstPercent,
  graceDays: config.cloud.graceDays,
});

/** The subscription as the Plan and usage page shows it. Dates are India days, as text. */
export async function subscriptionView(
  sql: Sql,
  workspaceId: string,
  now: Date,
): Promise<SubscriptionView> {
  const [plan, subscription] = await Promise.all([
    planOf(sql, workspaceId),
    getSubscription(sql, workspaceId),
  ]);
  const none: SubscriptionView = {
    state: 'none',
    term: null,
    seats: 0,
    renewalSeats: 0,
    periodEnd: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    canRenew: false,
    renewFrom: null,
  };
  if (operatorManaged(plan)) return { ...none, state: 'managed' };
  if (!subscription) return none;
  if (subscription.status === 'ended') return { ...none, state: 'ended' };
  const renewable = canRenew(subscription, now);
  return {
    state: subscription.status,
    term: subscription.term,
    seats: subscription.seats,
    renewalSeats: subscription.renewalSeats,
    periodEnd: formatTermDay(subscription.periodEnd),
    graceEndsAt: subscription.graceEndsAt ? formatTermDay(subscription.graceEndsAt) : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canRenew: renewable,
    renewFrom: renewable
      ? null
      : formatTermDay(new Date(subscription.periodEnd.getTime() - RENEWAL_WINDOW_DAYS * DAY_MS)),
  };
}
