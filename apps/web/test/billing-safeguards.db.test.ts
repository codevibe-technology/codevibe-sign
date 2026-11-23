import { createHmac, randomUUID } from 'node:crypto';
import type { MailMessage } from '@codevibe_technology/sign-core';
import { memoryFileStore } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingDetails } from '@/lib/billing/details';
import { listAudit } from '@/server/billing/audit';
import { billingConfig } from '@/server/billing/config';
import { saveBillingDetails } from '@/server/billing/details';
import { fulfilInstallHelp } from '@/server/billing/install-help';
import { listInvoices } from '@/server/billing/invoices';
import { reverseCredits, voidTestCredits } from '@/server/billing/credit-adjust';
import { fulfilCredits } from '@/server/billing/credit-orders';
import {
  consumeCredit,
  creditBalance,
  creditHistory,
  reserveCredit,
} from '@/server/billing/credits';
import { sendOperatorNotices } from '@/server/billing/notices';
import {
  confirmCheckout,
  createOrder,
  expireOrders,
  handleRazorpayWebhook,
  registerFulfilment,
  registerReversal,
  type BillingDeps,
  type CheckoutSession,
} from '@/server/billing/orders';
import type { RazorpayClient, RazorpayPayment } from '@/server/billing/razorpay';
import {
  createSeatsOrder,
  createSubscriptionOrder,
  MAX_EXTRA_SEATS,
  fulfilSeats,
  fulfilSubscription,
  getSubscription,
  reverseSeats,
  reverseSubscription,
  runSubscriptionTick,
  setRenewalSeats,
  subscriptionView,
} from '@/server/billing/subscriptions';
import { AppError } from '@/server/errors';
import { migrateAll } from '@/server/migrate';
import { setAccountPlanByName } from '@/server/plan-admin';
import { createWorkspace } from '@/server/workspaces';

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; image: null } | null,
  sql: null as unknown,
  deps: null as unknown,
  mode: 'hosted',
}));

vi.mock('@/server/auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/db', () => ({ db: () => state.sql }));
vi.mock('@/server/billing/runtime', () => ({ billingDeps: () => state.deps }));
vi.mock('@/server/client-address', () => ({ clientAddress: () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const url = process.env.DATABASE_URL;
const KEY_SECRET = 'key-secret-for-tests';
const HOSTED = { mode: 'hosted', freeOverrides: {} } as const;
const ist = (text: string) => new Date(`${text}+05:30`);
const START = ist('2026-11-23T10:00:00');

const ENV = {
  RAZORPAY_KEY_ID: 'rzp_live_TESTKEY123',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: 'webhook-secret-for-tests',
  INVOICE_SELLER_NAME: 'Codevibe Technology Private Limited',
  INVOICE_SELLER_GSTIN: '06AANCC6406C1ZX',
  INVOICE_SELLER_ADDRESS: 'Tower A 309, SAS Tower, Medicity, Gurugram, Haryana 122001',
  OPERATOR_EMAIL: 'ops@codevibe.example',
};

const BUYER: BillingDetails = {
  legalName: 'Bombay Paper Co',
  gstin: null,
  addressLine1: '4 Fort Road',
  addressLine2: null,
  city: 'Mumbai',
  pin: '400001',
  stateCode: '27',
  email: 'pay@bombay.example',
};

function fakeRazorpay() {
  const orders = new Map<string, number>();
  const payments = new Map<string, RazorpayPayment>();
  const client: RazorpayClient = {
    async createOrder(input) {
      const id = `order_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
      orders.set(id, input.amountPaise);
      return { id, amount: input.amountPaise, currency: 'INR', status: 'created' };
    },
    async fetchPayment(id) {
      const payment = payments.get(id);
      if (!payment) throw new Error('no such payment');
      return { ...payment };
    },
    async capturePayment(id) {
      return { ...payments.get(id)! };
    },
  };
  return {
    client,
    orders,
    pay(orderId: string): RazorpayPayment {
      const payment: RazorpayPayment = {
        id: `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
        orderId,
        amount: orders.get(orderId) ?? 0,
        currency: 'INR',
        status: 'captured',
      };
      payments.set(payment.id, payment);
      return payment;
    },
  };
}

async function appError(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe.skipIf(!url)('billing safeguards against PostgreSQL', () => {
  const schema = `web_guard_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let razorpay: ReturnType<typeof fakeRazorpay>;
  let sent: MailMessage[];
  let deps: BillingDeps;
  let now: Date;

  async function workspace(details: BillingDetails | null = BUYER) {
    const id = randomUUID();
    const email = `owner-${id.slice(0, 8)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, 'Asha', ${email})`;
    const ws = await createWorkspace(sql, { name: 'Acme', userId: id }, HOSTED);
    if (details) await saveBillingDetails(sql, { accountId: ws.accountId, userId: id, details });
    return { ...ws, owner: { id, email } };
  }

  type Ws = Awaited<ReturnType<typeof workspace>>;

  async function pay(accountId: string | null, checkout: CheckoutSession) {
    const payment = razorpay.pay(checkout.orderId);
    return confirmCheckout(sql, deps, {
      accountId,
      razorpayOrderId: checkout.orderId,
      paymentId: payment.id,
      signature: createHmac('sha256', KEY_SECRET)
        .update(`${checkout.orderId}|${payment.id}`)
        .digest('hex'),
    });
  }

  async function subscribe(ws: Ws, term: 'month' | 'year' = 'month', seats?: number) {
    const { checkout } = await createSubscriptionOrder(sql, deps, {
      accountId: ws.accountId,
      userId: ws.owner.id,
      term,
      seats,
    });
    expect((await pay(ws.accountId, checkout)).status).toBe('paid');
    return checkout;
  }

  const planOf = async (ws: Ws) => {
    const [row] = await sql<{ plan: string; extra_seats: number }[]>`
      select plan, extra_seats from app_accounts where id = ${ws.accountId}`;
    return row!;
  };

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 12, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0018_billing_safeguards');
    state.sql = sql;
  });

  beforeEach(async () => {
    await sql`delete from app_subscriptions`;
    await sql`delete from app_operator_notices`;
    razorpay = fakeRazorpay();
    sent = [];
    now = START;
    registerFulfilment('cloud_subscription', fulfilSubscription);
    registerFulfilment('extra_seats', fulfilSeats);
    registerFulfilment('install_help', fulfilInstallHelp);
    registerFulfilment('esign_credits', fulfilCredits);
    registerReversal('esign_credits', reverseCredits);
    registerReversal('cloud_subscription', reverseSubscription);
    registerReversal('extra_seats', reverseSeats);
    deps = {
      config: billingConfig(ENV),
      razorpay: razorpay.client,
      files: memoryFileStore(),
      mailer: {
        async send(message) {
          sent.push(message);
        },
      },
      now: () => now,
    };
    state.deps = deps;
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  const WEBHOOK_SECRET = ENV.RAZORPAY_WEBHOOK_SECRET;

  function delivery(event: string, payload: Record<string, unknown>) {
    const rawBody = JSON.stringify({ event, payload });
    return {
      rawBody,
      signature: createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'),
      eventId: `evt_${randomUUID()}`,
    };
  }

  const refund = (paymentId: string, amount: number, event = 'refund.processed') =>
    delivery(event, { refund: { entity: { id: 'rfnd_ABC12345', payment_id: paymentId, amount } } });

  const orderRow = async (razorpayOrderId: string) => {
    const [row] = await sql<
      { id: string; status: string; unapplied_reason: string | null; razorpay_payment_id: string }[]
    >`select id, status, unapplied_reason, razorpay_payment_id from app_billing_orders
      where razorpay_order_id = ${razorpayOrderId}`;
    return row!;
  };

  const notices = () =>
    sendOperatorNotices(sql, {
      mailer: deps.mailer,
      operatorEmail: 'ops@codevibe.example',
      now: deps.now,
    });

  async function addPeople(ws: Ws, count: number) {
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      await sql`insert into auth_users (id, name, email) values (${id}, 'Member', ${`m-${id}@example.com`})`;
      await sql`insert into app_members (workspace_id, user_id, role) values (${ws.id}, ${id}, 'member')`;
    }
  }

  async function creditsOrder(ws: Ws, credits: number) {
    return createOrder(sql, deps, {
      accountId: ws.accountId,
      kind: 'esign_credits',
      lines: [
        {
          description: `Aadhaar eSign credits × ${credits} @ ₹35`,
          quantity: credits,
          unitPaise: 3_500,
        },
      ],
      payload: { credits },
      buyer: BUYER,
      createdBy: ws.owner.id,
      summary: `${credits} Aadhaar eSign credits`,
    });
  }

  describe('extra members are bound to the term they were priced for', () => {
    it('does not add members bought for the last day of a year to the next year', async () => {
      const ws = await workspace();
      await subscribe(ws, 'year');
      now = ist('2027-11-22T10:00:00');
      const seats = await createSeatsOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        add: 400,
      });
      const renewal = await createSubscriptionOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        term: 'year',
        seats: 0,
      });
      expect((await pay(ws.accountId, renewal.checkout)).status).toBe('paid');
      const outcome = await pay(ws.accountId, seats.checkout);
      expect(outcome).toMatchObject({ status: 'unapplied', reason: 'term_changed', charged: true });
      expect((await planOf(ws)).extra_seats).toBe(0);
      expect((await getSubscription(sql, ws.accountId))!.renewalSeats).toBe(0);
      expect(await orderRow(seats.checkout.orderId)).toMatchObject({
        status: 'paid_unapplied',
        unapplied_reason: 'term_changed',
      });
      expect((await listInvoices(sql, ws.accountId)).length).toBe(2);

      expect(await notices()).toBe(1);
      expect(await notices()).toBe(0);
      const mail = sent.at(-1)!;
      expect(mail.to).toBe('ops@codevibe.example');
      expect(mail.subject).toBe('A payment was received but not applied');
      expect(mail.text).toContain('Refund the payment from the Razorpay dashboard');
      expect(mail.text).toContain('reason: term_changed');
    });

    it('never goes over the most extra members when several orders are paid', async () => {
      const ws = await workspace();
      await subscribe(ws, 'year');
      const order = () =>
        createSeatsOrder(sql, deps, { accountId: ws.accountId, userId: ws.owner.id, add: 300 });
      const [first, second] = [await order(), await order()];
      expect((await pay(ws.accountId, first.checkout)).status).toBe('paid');
      expect(await pay(ws.accountId, second.checkout)).toMatchObject({
        status: 'unapplied',
        reason: 'seat_limit',
      });
      expect((await planOf(ws)).extra_seats).toBe(300);
      expect(MAX_EXTRA_SEATS).toBe(500);
    });
  });

  describe('orders stop standing', () => {
    it('applies nothing for a payment made after the window and tells the operator', async () => {
      const ws = await workspace();
      const { checkout } = await createSubscriptionOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        term: 'month',
      });
      now = new Date(START.getTime() + 31 * 60_000);
      expect(await expireOrders(sql, deps)).toBeGreaterThanOrEqual(1);
      expect((await orderRow(checkout.orderId)).status).toBe('expired');
      expect(await pay(ws.accountId, checkout)).toMatchObject({
        status: 'unapplied',
        reason: 'expired',
        charged: true,
      });
      expect((await planOf(ws)).plan).toBe('free');
      expect(await listInvoices(sql, ws.accountId)).toEqual([]);
      // Confirming again changes nothing and still says so.
      const payment = (await orderRow(checkout.orderId)).razorpay_payment_id;
      const again = await confirmCheckout(sql, deps, {
        accountId: ws.accountId,
        razorpayOrderId: checkout.orderId,
        paymentId: payment,
        signature: createHmac('sha256', KEY_SECRET)
          .update(`${checkout.orderId}|${payment}`)
          .digest('hex'),
      });
      expect(again.status).toBe('unapplied');
      expect(await notices()).toBe(1);
    });

    it('honours a payment made in time when the news of it comes late', async () => {
      const ws = await workspace();
      const { checkout } = await createSubscriptionOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        term: 'month',
      });
      const payment = razorpay.pay(checkout.orderId);
      payment.createdAt = new Date(START.getTime() + 10 * 60_000);
      now = new Date(START.getTime() + 5 * 3_600_000);
      await expireOrders(sql, deps);
      const outcome = await handleRazorpayWebhook(
        sql,
        deps,
        delivery('payment.captured', {
          payment: {
            entity: {
              id: payment.id,
              order_id: payment.orderId,
              amount: payment.amount,
              currency: 'INR',
              status: 'captured',
              created_at: Math.floor(payment.createdAt.getTime() / 1000),
            },
          },
        }),
      );
      expect(outcome).toBe('processed');
      expect((await planOf(ws)).plan).toBe('cloud');
    });

    it('does not capture an authorised payment for an order that has expired', async () => {
      const ws = await workspace();
      const { checkout } = await createSubscriptionOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        term: 'month',
      });
      now = new Date(START.getTime() + 45 * 60_000);
      const payment = razorpay.pay(checkout.orderId);
      payment.status = 'authorized';
      const capture = vi.spyOn(razorpay.client, 'capturePayment');
      const outcome = await confirmCheckout(sql, deps, {
        accountId: ws.accountId,
        razorpayOrderId: checkout.orderId,
        paymentId: payment.id,
        signature: createHmac('sha256', KEY_SECRET)
          .update(`${checkout.orderId}|${payment.id}`)
          .digest('hex'),
      });
      expect(outcome).toMatchObject({ status: 'unapplied', reason: 'expired', charged: false });
      expect(capture).not.toHaveBeenCalled();
      expect((await planOf(ws)).plan).toBe('free');
    });

    it('starts one term when two first orders are both paid', async () => {
      const ws = await workspace();
      const open = () =>
        createSubscriptionOrder(sql, deps, {
          accountId: ws.accountId,
          userId: ws.owner.id,
          term: 'month',
        });
      const [a, b] = [await open(), await open()];
      expect((await pay(ws.accountId, a.checkout)).status).toBe('paid');
      expect(await pay(ws.accountId, b.checkout)).toMatchObject({
        status: 'unapplied',
        reason: 'term_changed',
      });
      expect((await getSubscription(sql, ws.accountId))!.periodEnd).toEqual(
        ist('2026-12-23T10:00:00'),
      );
    });

    it('applies nothing for an order opened with test keys once the install is live', async () => {
      const ws = await workspace();
      deps = { ...deps, config: billingConfig({ ...ENV, RAZORPAY_KEY_ID: 'rzp_test_TESTKEY123' }) };
      const { checkout } = await createSubscriptionOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        term: 'month',
      });
      deps = { ...deps, config: billingConfig({ ...ENV, BILLING_LIVE: 'true' }) };
      expect(await pay(ws.accountId, checkout)).toMatchObject({
        status: 'unapplied',
        reason: 'test_order',
      });
      expect((await planOf(ws)).plan).toBe('free');
    });
  });

  describe('extra members cover the people in the workspace', () => {
    it('refuses a term and a renewal setting with fewer than the workspace needs', async () => {
      const ws = await workspace();
      await addPeople(ws, 27);
      const short = await appError(
        createSubscriptionOrder(sql, deps, {
          accountId: ws.accountId,
          userId: ws.owner.id,
          term: 'month',
          seats: 1,
        }),
      );
      expect(short.field).toBe('seats');
      expect(short.message).toBe(
        'This account has 28 members and open invitations across its workspaces, and 25 are included, so it needs at least 3 extra members. To pay for 1, first remove 2 people or withdraw their invitations.',
      );
      await subscribe(ws, 'month', 3);
      const lower = await appError(
        setRenewalSeats(sql, {
          accountId: ws.accountId,
          userId: ws.owner.id,
          seats: 0,
          config: deps.config,
          now,
        }),
      );
      expect(lower.field).toBe('seats');
      const kept = await setRenewalSeats(sql, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        seats: 4,
        config: deps.config,
        now,
      });
      expect(kept.renewalSeats).toBe(4);
    });
  });

  describe('test credits', () => {
    it('are told apart and removed, unused ones only, when the install goes live', async () => {
      const ws = await workspace();
      const test = {
        ...deps,
        config: billingConfig({ ...ENV, RAZORPAY_KEY_ID: 'rzp_test_TESTKEY123' }),
      };
      deps = test;
      const bought = await creditsOrder(ws, 10);
      expect((await pay(ws.accountId, bought.checkout)).status).toBe('paid');
      for (const ref of ['s1', 's2', 's3']) {
        await reserveCredit(sql, { accountId: ws.accountId, ref });
        await consumeCredit(sql, { accountId: ws.accountId, ref });
      }
      await reserveCredit(sql, { accountId: ws.accountId, ref: 'held' });
      expect(await voidTestCredits(sql, now)).toBe(6);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 1 });
      expect(await voidTestCredits(sql, new Date(now.getTime() + 1000))).toBe(0);

      deps = { ...deps, config: billingConfig(ENV) };
      const real = await creditsOrder(ws, 10);
      expect((await pay(ws.accountId, real.checkout)).status).toBe('paid');
      await reserveCredit(sql, { accountId: ws.accountId, ref: 's4' });
      await consumeCredit(sql, { accountId: ws.accountId, ref: 's4' });
      expect(await voidTestCredits(sql, new Date(now.getTime() + 2000))).toBe(0);
      expect((await creditBalance(sql, ws.accountId)).available).toBe(9);
      expect(
        (await creditHistory(sql, ws.accountId)).filter((e) => e.kind === 'void'),
      ).toHaveLength(1);
    });
  });

  describe('refunds and disputes', () => {
    it('takes back the unused credits of a refunded order, once', async () => {
      const ws = await workspace();
      const bought = await creditsOrder(ws, 10);
      await pay(ws.accountId, bought.checkout);
      for (const ref of ['a', 'b', 'c']) {
        await reserveCredit(sql, { accountId: ws.accountId, ref });
        await consumeCredit(sql, { accountId: ws.accountId, ref });
      }
      const row = await orderRow(bought.checkout.orderId);
      const full = refund(row.razorpay_payment_id, bought.checkout.amountPaise);
      expect(await handleRazorpayWebhook(sql, deps, full)).toBe('processed');
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
      expect((await orderRow(bought.checkout.orderId)).status).toBe('refunded');
      const [audit] = await listAudit(
        sql,
        { accountId: ws.accountId },
        { prefix: 'billing.payment_refunded' },
      );
      expect(audit!.data).toMatchObject({ creditsTakenBack: 7, creditsAlreadyUsed: 3 });
      // The same refund under a new delivery id changes nothing more.
      expect(
        await handleRazorpayWebhook(
          sql,
          deps,
          refund(row.razorpay_payment_id, bought.checkout.amountPaise),
        ),
      ).toBe('processed');
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
      expect(await notices()).toBe(1);
      expect(sent.at(-1)!.subject).toBe('A payment was refunded');
    });

    it('only tells the operator about a partial refund, a refund not processed yet and a new dispute', async () => {
      const ws = await workspace();
      const bought = await creditsOrder(ws, 10);
      await pay(ws.accountId, bought.checkout);
      const { razorpay_payment_id: paymentId } = await orderRow(bought.checkout.orderId);
      await handleRazorpayWebhook(sql, deps, refund(paymentId, 100));
      await handleRazorpayWebhook(
        sql,
        deps,
        refund(paymentId, bought.checkout.amountPaise, 'refund.created'),
      );
      await handleRazorpayWebhook(
        sql,
        deps,
        delivery('payment.dispute.created', {
          dispute: { entity: { id: 'disp_ABC12345', payment_id: paymentId, amount: 100 } },
        }),
      );
      expect((await creditBalance(sql, ws.accountId)).available).toBe(10);
      expect((await orderRow(bought.checkout.orderId)).status).toBe('paid');
      expect(await notices()).toBe(3);
      expect(await handleRazorpayWebhook(sql, deps, refund('pay_UNKNOWN12345', 100))).toBe(
        'ignored',
      );
    });

    it('ends a refunded first term and puts back the term before a refunded renewal', async () => {
      const first = await workspace();
      const started = await subscribe(first);
      const { razorpay_payment_id: firstPayment } = await orderRow(started.orderId);
      await handleRazorpayWebhook(
        sql,
        deps,
        delivery('payment.dispute.lost', {
          dispute: {
            entity: { id: 'disp_LOST1234', payment_id: firstPayment, amount: started.amountPaise },
          },
        }),
      );
      expect((await planOf(first)).plan).toBe('free');
      expect((await getSubscription(sql, first.accountId))!.status).toBe('ended');

      const ws = await workspace();
      await subscribe(ws);
      now = ist('2026-12-20T10:00:00');
      const renewal = await subscribe(ws);
      expect((await getSubscription(sql, ws.accountId))!.periodEnd).toEqual(
        ist('2027-01-23T10:00:00'),
      );
      const { razorpay_payment_id: paymentId } = await orderRow(renewal.orderId);
      await handleRazorpayWebhook(sql, deps, refund(paymentId, renewal.amountPaise));
      const back = (await getSubscription(sql, ws.accountId))!;
      expect(back.status).toBe('active');
      expect(back.periodEnd).toEqual(ist('2026-12-23T10:00:00'));
      expect((await planOf(ws)).plan).toBe('cloud');
    });

    it('removes refunded extra members from their term', async () => {
      const ws = await workspace();
      await subscribe(ws, 'year', 2);
      const seats = await createSeatsOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        add: 5,
      });
      await pay(ws.accountId, seats.checkout);
      expect((await planOf(ws)).extra_seats).toBe(7);
      const { razorpay_payment_id: paymentId } = await orderRow(seats.checkout.orderId);
      await handleRazorpayWebhook(sql, deps, refund(paymentId, seats.checkout.amountPaise));
      expect((await planOf(ws)).extra_seats).toBe(2);
      expect((await getSubscription(sql, ws.accountId))!.renewalSeats).toBe(2);
    });
  });

  describe('a plan the operator set', () => {
    it('is not sold to, renewed, lowered or ended by billing', async () => {
      const ws = await workspace();
      await subscribe(ws);
      now = ist('2026-12-20T10:00:00');
      const renewal = await createSubscriptionOrder(sql, deps, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        term: 'month',
      });
      await setAccountPlanByName(sql, { target: ws.slug, plan: 'unlimited', changedBy: 'ops' });

      expect((await subscriptionView(sql, ws.accountId, now)).state).toBe('managed');
      const refused = await appError(
        createSubscriptionOrder(sql, deps, {
          accountId: ws.accountId,
          userId: ws.owner.id,
          term: 'month',
        }),
      );
      expect(refused.message).toContain('managed by our team');
      await appError(
        createSeatsOrder(sql, deps, { accountId: ws.accountId, userId: ws.owner.id, add: 1 }),
      );
      // The renewal opened before the change is paid: the plan is not pulled down to Cloud.
      expect(await pay(ws.accountId, renewal.checkout)).toMatchObject({
        status: 'unapplied',
        reason: 'plan_managed',
      });
      expect((await planOf(ws)).plan).toBe('unlimited');

      await setAccountPlanByName(sql, { target: ws.slug, plan: 'cloud', changedBy: 'ops' });
      now = ist('2027-02-01T10:00:00');
      await runSubscriptionTick(sql, deps);
      await runSubscriptionTick(sql, deps);
      expect((await getSubscription(sql, ws.accountId))!.status).toBe('ended');
      expect((await planOf(ws)).plan).toBe('cloud');
    });
  });

  describe('a booking and its order', () => {
    it('cannot be paid when the booking is missing', async () => {
      const { checkout } = await createOrder(sql, deps, {
        accountId: null,
        kind: 'install_help',
        lines: [
          { description: 'Codevibe Sign installation help', quantity: 1, unitPaise: 199_900 },
        ],
        payload: { bookingId: 'book_missing' },
        buyer: BUYER,
        createdBy: null,
        summary: 'Codevibe Sign installation help',
      });
      await expect(pay(null, checkout)).rejects.toThrow(/has no booking/);
      expect((await orderRow(checkout.orderId)).status).toBe('created');
    });

    it('is saved with its order or not at all', async () => {
      const before = await sql<{ n: number }[]>`select count(*)::int as n from app_billing_orders`;
      await expect(
        createOrder(sql, deps, {
          accountId: null,
          kind: 'install_help',
          lines: [
            { description: 'Codevibe Sign installation help', quantity: 1, unitPaise: 199_900 },
          ],
          payload: {},
          buyer: BUYER,
          createdBy: null,
          summary: 'Codevibe Sign installation help',
          alongside: async () => {
            throw new Error('booking could not be saved');
          },
        }),
      ).rejects.toThrow('booking could not be saved');
      const after = await sql<{ n: number }[]>`select count(*)::int as n from app_billing_orders`;
      expect(after[0]!.n).toBe(before[0]!.n);
    });
  });

  describe('invoices', () => {
    it('are dated in the order they are numbered', async () => {
      const ws = await workspace();
      let tick = 0;
      deps = { ...deps, now: () => new Date(START.getTime() + (tick += 1) * 1000) };
      const [a, b] = [await creditsOrder(ws, 10), await creditsOrder(ws, 10)];
      await Promise.all([pay(ws.accountId, a.checkout), pay(ws.accountId, b.checkout)]);
      const invoices = await sql<{ number: string; issued_at: Date }[]>`
        select number, issued_at from app_invoices where account_id = ${ws.accountId} order by number`;
      expect(invoices).toHaveLength(2);
      expect(invoices[1]!.issued_at.getTime()).toBeGreaterThan(invoices[0]!.issued_at.getTime());
    });
  });
});
