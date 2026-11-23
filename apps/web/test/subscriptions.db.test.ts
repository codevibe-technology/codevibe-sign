import { createHmac, randomUUID } from 'node:crypto';
import type { MailMessage } from '@codevibe_technology/sign-core';
import { memoryFileStore } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingDetails } from '@/lib/billing/details';
import { installBookingSchema } from '@/lib/billing/install-help';
import { listAudit } from '@/server/billing/audit';
import { billingConfig } from '@/server/billing/config';
import { saveBillingDetails } from '@/server/billing/details';
import {
  createInstallBooking,
  enforceBookingLimit,
  fulfilInstallHelp,
  notifyInstallBookings,
} from '@/server/billing/install-help';
import { listInvoices } from '@/server/billing/invoices';
import {
  confirmCheckout,
  registerFulfilment,
  type BillingDeps,
  type CheckoutSession,
} from '@/server/billing/orders';
import type { RazorpayClient, RazorpayPayment } from '@/server/billing/razorpay';
import {
  createSeatsOrder,
  createSubscriptionOrder,
  fulfilSeats,
  fulfilSubscription,
  getSubscription,
  runSubscriptionTick,
  scheduleCancel,
  setRenewalSeats,
  subscriptionView,
} from '@/server/billing/subscriptions';
import { AppError } from '@/server/errors';
import { migrateAll } from '@/server/migrate';
import { setWorkspacePlan } from '@/server/plan-admin';
import { workspacePlan } from '@/server/plans';
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
const DAY = 86_400_000;
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

describe.skipIf(!url)('subscriptions against PostgreSQL', () => {
  const schema = `web_subs_test_${process.pid}_${Date.now()}`;
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
    if (details) await saveBillingDetails(sql, { workspaceId: ws.id, userId: id, details });
    return { ...ws, owner: { id, email } };
  }

  type Ws = Awaited<ReturnType<typeof workspace>>;

  async function pay(workspaceId: string | null, checkout: CheckoutSession) {
    const payment = razorpay.pay(checkout.orderId);
    return confirmCheckout(sql, deps, {
      workspaceId,
      razorpayOrderId: checkout.orderId,
      paymentId: payment.id,
      signature: createHmac('sha256', KEY_SECRET)
        .update(`${checkout.orderId}|${payment.id}`)
        .digest('hex'),
    });
  }

  async function subscribe(ws: Ws, term: 'month' | 'year' = 'month', seats?: number) {
    const { checkout } = await createSubscriptionOrder(sql, deps, {
      workspaceId: ws.id,
      userId: ws.owner.id,
      term,
      seats,
    });
    expect((await pay(ws.id, checkout)).status).toBe('paid');
    return checkout;
  }

  const planOf = async (ws: Ws) => {
    const [row] = await sql<{ plan: string; extra_seats: number }[]>`
      select plan, extra_seats from app_workspaces where id = ${ws.id}`;
    return row!;
  };

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 12, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0015_subscriptions');
    state.sql = sql;
  });

  beforeEach(async () => {
    // The clock looks at every subscription, so each test starts with none.
    await sql`delete from app_subscriptions`;
    razorpay = fakeRazorpay();
    sent = [];
    now = START;
    registerFulfilment('cloud_subscription', fulfilSubscription);
    registerFulfilment('extra_seats', fulfilSeats);
    registerFulfilment('install_help', fulfilInstallHelp);
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

  describe('starting', () => {
    it('moves a free workspace to cloud for one month when the payment is confirmed', async () => {
      const ws = await workspace();
      const checkout = await subscribe(ws);
      // 999 plus 18% IGST for a buyer outside Haryana.
      expect(checkout.amountPaise).toBe(117_882);
      expect(await planOf(ws)).toEqual({ plan: 'cloud', extra_seats: 0 });
      const subscription = (await getSubscription(sql, ws.id))!;
      expect(subscription.status).toBe('active');
      expect(subscription.periodStart).toEqual(START);
      expect(subscription.periodEnd).toEqual(ist('2026-12-23T10:00:00'));
      const [invoice] = await listInvoices(sql, ws.id);
      expect(invoice!.order.lines[0]!.description).toBe(
        'Codevibe Sign Cloud, 1 month (23 Nov 2026 to 22 Dec 2026)',
      );
      expect(
        (await listAudit(sql, ws.id, { prefix: 'subscription.' })).map((a) => a.action),
      ).toEqual(['subscription.started']);
      expect((await workspacePlan(sql, ws.id, HOSTED)).limits.members).toBe(25);
    });

    it('charges ten months for a year and includes extra members', async () => {
      const ws = await workspace();
      const { order } = await createSubscriptionOrder(sql, deps, {
        workspaceId: ws.id,
        userId: ws.owner.id,
        term: 'year',
        seats: 3,
      });
      expect(order.lines.map((l) => [l.quantity, l.unitPaise])).toEqual([
        [1, 999_000],
        [3, 99_000],
      ]);
      expect(order.tax.taxablePaise).toBe(999_000 + 297_000);
      expect(order.lines[1]!.description).toBe(
        'Extra members × 3, 1 year (23 Nov 2026 to 22 Nov 2027)',
      );
    });

    it('needs billing details and open payments, and leaves the plan alone until paid', async () => {
      const bare = await workspace(null);
      const missing = await appError(
        createSubscriptionOrder(sql, deps, {
          workspaceId: bare.id,
          userId: bare.owner.id,
          term: 'month',
        }),
      );
      expect(missing.field).toBe('billingDetails');

      const ws = await workspace();
      await createSubscriptionOrder(sql, deps, {
        workspaceId: ws.id,
        userId: ws.owner.id,
        term: 'month',
      });
      expect((await planOf(ws)).plan).toBe('free');
      expect(await getSubscription(sql, ws.id)).toBeNull();

      const closed = { ...deps, config: billingConfig({}) };
      const err = await appError(
        createSubscriptionOrder(sql, closed, {
          workspaceId: ws.id,
          userId: ws.owner.id,
          term: 'month',
        }),
      );
      expect(err.message).toBe('Payments are not available here yet.');
    });

    it('applies one payment once however often it is confirmed', async () => {
      const ws = await workspace();
      const { checkout } = await createSubscriptionOrder(sql, deps, {
        workspaceId: ws.id,
        userId: ws.owner.id,
        term: 'month',
      });
      const payment = razorpay.pay(checkout.orderId);
      const confirm = () =>
        confirmCheckout(sql, deps, {
          workspaceId: ws.id,
          razorpayOrderId: checkout.orderId,
          paymentId: payment.id,
          signature: createHmac('sha256', KEY_SECRET)
            .update(`${checkout.orderId}|${payment.id}`)
            .digest('hex'),
        });
      await Promise.all([confirm(), confirm(), confirm(), confirm()]);
      await confirm();
      expect((await getSubscription(sql, ws.id))!.periodEnd).toEqual(ist('2026-12-23T10:00:00'));
      expect(await listInvoices(sql, ws.id)).toHaveLength(1);
      const [changes] = await sql<{ n: number }[]>`
        select count(*)::int as n from app_plan_changes where workspace_id = ${ws.id}`;
      expect(changes!.n).toBe(1);
    });
  });

  describe('renewing', () => {
    it('opens in the last seven days and extends from the end of the paid term', async () => {
      const ws = await workspace();
      await subscribe(ws);
      now = ist('2026-12-10T10:00:00');
      const early = await appError(
        createSubscriptionOrder(sql, deps, {
          workspaceId: ws.id,
          userId: ws.owner.id,
          term: 'month',
        }),
      );
      expect(early.message).toBe(
        'This workspace is paid up to 23 Dec 2026. You can pay for the next term from 16 Dec 2026.',
      );
      expect((await subscriptionView(sql, ws.id, now)).canRenew).toBe(false);

      now = ist('2026-12-20T18:00:00');
      expect((await subscriptionView(sql, ws.id, now)).canRenew).toBe(true);
      await subscribe(ws);
      const subscription = (await getSubscription(sql, ws.id))!;
      expect(subscription.periodStart).toEqual(ist('2026-12-23T10:00:00'));
      expect(subscription.periodEnd).toEqual(ist('2027-01-23T10:00:00'));
      expect(
        (await listAudit(sql, ws.id, { prefix: 'subscription.' })).map((a) => a.action),
      ).toContain('subscription.renewed');
    });

    it('in the grace days keeps the dates of the term and makes the workspace active again', async () => {
      const ws = await workspace();
      await subscribe(ws);
      now = ist('2026-12-25T10:00:00');
      expect((await runSubscriptionTick(sql, deps)).graceStarted).toBe(1);
      expect((await getSubscription(sql, ws.id))!.status).toBe('grace');
      expect((await planOf(ws)).plan).toBe('cloud');
      await subscribe(ws);
      const subscription = (await getSubscription(sql, ws.id))!;
      expect(subscription.status).toBe('active');
      expect(subscription.graceEndsAt).toBeNull();
      expect(subscription.periodEnd).toEqual(ist('2027-01-23T10:00:00'));
    });

    it('starts a fresh term from the payment after the subscription ended', async () => {
      const ws = await workspace();
      await subscribe(ws);
      now = ist('2027-01-05T10:00:00');
      await runSubscriptionTick(sql, deps);
      await runSubscriptionTick(sql, deps);
      expect((await planOf(ws)).plan).toBe('free');
      now = ist('2027-02-10T09:00:00');
      await subscribe(ws);
      const subscription = (await getSubscription(sql, ws.id))!;
      expect(subscription.periodStart).toEqual(now);
      expect(subscription.status).toBe('active');
      expect((await planOf(ws)).plan).toBe('cloud');
    });
  });

  describe('extra members', () => {
    it('charges the days left, adds them at once and to the next term', async () => {
      const ws = await workspace();
      await subscribe(ws);
      now = ist('2026-12-08T10:00:00');
      const { order, checkout } = await createSeatsOrder(sql, deps, {
        workspaceId: ws.id,
        userId: ws.owner.id,
        add: 4,
      });
      // 15 of 30 days of 99 rupees.
      expect(order.lines[0]).toMatchObject({ quantity: 4, unitPaise: 4_950 });
      expect(order.lines[0]!.description).toBe('Extra members × 4, 15 days to 22 Dec 2026');
      expect((await planOf(ws)).extra_seats).toBe(0);
      await pay(ws.id, checkout);
      expect((await planOf(ws)).extra_seats).toBe(4);
      expect((await workspacePlan(sql, ws.id, HOSTED)).limits.members).toBe(29);
      const subscription = (await getSubscription(sql, ws.id))!;
      expect([subscription.seats, subscription.renewalSeats]).toEqual([4, 4]);

      now = ist('2026-12-20T10:00:00');
      const renewal = await createSubscriptionOrder(sql, deps, {
        workspaceId: ws.id,
        userId: ws.owner.id,
        term: 'month',
      });
      expect(renewal.order.lines.map((l) => [l.quantity, l.unitPaise])).toEqual([
        [1, 99_900],
        [4, 9_900],
      ]);
    });

    it('takes fewer members from the next term only', async () => {
      const ws = await workspace();
      await subscribe(ws, 'month', 5);
      await setRenewalSeats(sql, { workspaceId: ws.id, userId: ws.owner.id, seats: 2 });
      expect((await planOf(ws)).extra_seats).toBe(5);
      now = ist('2026-12-20T10:00:00');
      await subscribe(ws);
      expect((await planOf(ws)).extra_seats).toBe(2);
    });

    it('is refused without a running term', async () => {
      const ws = await workspace();
      const err = await appError(
        createSeatsOrder(sql, deps, { workspaceId: ws.id, userId: ws.owner.id, add: 1 }),
      );
      expect(err.message).toContain('Upgrade to Cloud first');
    });
  });

  describe('the clock', () => {
    it('reminds at seven, three and one days, once each, with the price to pay', async () => {
      const ws = await workspace();
      await subscribe(ws);
      sent.length = 0;
      now = ist('2026-12-14T10:00:00');
      expect((await runSubscriptionTick(sql, deps)).reminded).toBe(0);
      for (const day of ['2026-12-16T12:00:00', '2026-12-20T12:00:00', '2026-12-22T12:00:00']) {
        now = ist(day);
        expect((await runSubscriptionTick(sql, deps)).reminded).toBe(1);
        expect((await runSubscriptionTick(sql, deps)).reminded).toBe(0);
      }
      const reminders = sent.filter((m) => m.meta?.kind === 'subscription_reminder');
      // The billing address and the owner each get one per stage.
      expect(reminders).toHaveLength(6);
      expect(new Set(reminders.map((m) => m.to))).toEqual(new Set([BUYER.email, ws.owner.email]));
      expect(reminders[0]!.subject).toBe('Codevibe Sign Cloud for Acme ends on 23 Dec 2026');
      expect(reminders[0]!.text).toContain('₹999 plus GST');
      expect(reminders.at(-1)!.text).toContain('in 1 day.');
    });

    it('sends the reminder again when the mail failed', async () => {
      const ws = await workspace();
      await subscribe(ws);
      now = ist('2026-12-17T12:00:00');
      const failing = {
        ...deps,
        mailer: {
          async send() {
            throw new Error('smtp down');
          },
        },
      };
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect((await runSubscriptionTick(sql, failing)).reminded).toBe(0);
      error.mockRestore();
      sent.length = 0;
      expect((await runSubscriptionTick(sql, deps)).reminded).toBe(1);
      expect(sent.length).toBeGreaterThan(0);
    });

    it('gives seven grace days, then falls back to free and keeps everything', async () => {
      const ws = await workspace();
      await subscribe(ws, 'month', 3);
      await sql`
        insert into app_templates (id, workspace_id, name, definition, created_by)
        select 'tpl_' || g, ${ws.id}, 'T' || g, '{}'::jsonb, ${ws.owner.id}
        from generate_series(1, 4) g`;

      now = ist('2026-12-23T10:00:01');
      expect(await runSubscriptionTick(sql, deps)).toMatchObject({ graceStarted: 1, ended: 0 });
      expect(await runSubscriptionTick(sql, deps)).toMatchObject({ graceStarted: 0, ended: 0 });
      const grace = (await getSubscription(sql, ws.id))!;
      expect(grace.status).toBe('grace');
      expect(grace.graceEndsAt).toEqual(new Date(grace.periodEnd.getTime() + 7 * DAY));
      expect(await planOf(ws)).toEqual({ plan: 'cloud', extra_seats: 3 });
      expect(sent.filter((m) => m.meta?.kind === 'subscription_grace')).toHaveLength(2);

      now = ist('2026-12-30T09:00:00');
      expect((await runSubscriptionTick(sql, deps)).ended).toBe(0);
      now = ist('2026-12-30T10:00:01');
      const ticks = await Promise.all([
        runSubscriptionTick(sql, deps),
        runSubscriptionTick(sql, deps),
        runSubscriptionTick(sql, deps),
      ]);
      expect(ticks.reduce((sum, t) => sum + t.ended, 0)).toBe(1);
      expect(await planOf(ws)).toEqual({ plan: 'free', extra_seats: 0 });
      expect((await getSubscription(sql, ws.id))!.status).toBe('ended');
      expect(sent.filter((m) => m.meta?.kind === 'subscription_ended')).toHaveLength(2);
      const [kept] = await sql<{ n: number }[]>`
        select count(*)::int as n from app_templates where workspace_id = ${ws.id}`;
      expect(kept!.n).toBe(4);
      expect((await workspacePlan(sql, ws.id, HOSTED)).limits.members).toBe(2);
      const [change] = await sql<{ from_plan: string; to_plan: string; changed_by: string }[]>`
        select from_plan, to_plan, changed_by from app_plan_changes
        where workspace_id = ${ws.id} order by created_at desc limit 1`;
      expect(change).toEqual({ from_plan: 'cloud', to_plan: 'free', changed_by: 'billing' });
      expect((await subscriptionView(sql, ws.id, now)).state).toBe('ended');
    });

    it('ends a cancelled term on its last day, without grace or reminders', async () => {
      const ws = await workspace();
      await subscribe(ws);
      await scheduleCancel(sql, { workspaceId: ws.id, userId: ws.owner.id, cancel: true });
      sent.length = 0;
      now = ist('2026-12-20T10:00:00');
      expect(await runSubscriptionTick(sql, deps)).toEqual({
        reminded: 0,
        graceStarted: 0,
        ended: 0,
      });
      expect((await planOf(ws)).plan).toBe('cloud');
      now = ist('2026-12-23T10:00:01');
      expect(await runSubscriptionTick(sql, deps)).toEqual({
        reminded: 0,
        graceStarted: 0,
        ended: 1,
      });
      expect((await planOf(ws)).plan).toBe('free');
      expect(sent.every((m) => m.meta?.kind === 'subscription_ended')).toBe(true);
    });

    it('lets a scheduled cancel be undone', async () => {
      const ws = await workspace();
      await subscribe(ws);
      await scheduleCancel(sql, { workspaceId: ws.id, userId: ws.owner.id, cancel: true });
      await scheduleCancel(sql, { workspaceId: ws.id, userId: ws.owner.id, cancel: false });
      now = ist('2026-12-23T10:00:01');
      expect((await runSubscriptionTick(sql, deps)).graceStarted).toBe(1);
      expect((await listAudit(sql, ws.id, { prefix: 'subscription.cancel' })).length).toBe(2);
    });

    it('never touches a plan the operator set', async () => {
      const ws = await workspace();
      await setWorkspacePlan(sql, { slug: ws.slug, plan: 'cloud', changedBy: 'ops' });
      now = ist('2030-01-01T00:00:00');
      await runSubscriptionTick(sql, deps);
      expect((await planOf(ws)).plan).toBe('cloud');
      expect((await subscriptionView(sql, ws.id, now)).state).toBe('managed');
      const err = await appError(
        createSubscriptionOrder(sql, deps, {
          workspaceId: ws.id,
          userId: ws.owner.id,
          term: 'month',
        }),
      );
      expect(err.message).toContain('managed by our team');
    });

    it('leaves a plan the operator raised after the term alone when the term ends', async () => {
      const ws = await workspace();
      await subscribe(ws);
      await setWorkspacePlan(sql, { slug: ws.slug, plan: 'unlimited', changedBy: 'ops' });
      now = ist('2027-01-05T10:00:00');
      await runSubscriptionTick(sql, deps);
      await runSubscriptionTick(sql, deps);
      expect((await getSubscription(sql, ws.id))!.status).toBe('ended');
      expect((await planOf(ws)).plan).toBe('unlimited');
    });
  });

  describe('actions', () => {
    it('refuse members and viewers, other workspaces and self-hosted installs', async () => {
      const { startSubscriptionAction, scheduleCancelAction } = await import(
        '@/server/actions/subscriptions'
      );
      const ws = await workspace();
      const other = await workspace();
      const memberId = randomUUID();
      await sql`insert into auth_users (id, name, email) values (${memberId}, 'M', ${`${memberId}@example.com`})`;
      await sql`insert into app_members (workspace_id, user_id, role) values (${ws.id}, ${memberId}, 'member')`;

      state.user = { id: memberId, name: 'M', email: 'm@example.com', image: null };
      expect(await startSubscriptionAction({ workspaceId: ws.id, term: 'month' })).toMatchObject({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(await startSubscriptionAction({ workspaceId: other.id, term: 'month' })).toMatchObject(
        {
          ok: false,
          code: 'NOT_FOUND',
        },
      );

      state.user = { id: ws.owner.id, name: 'Asha', email: ws.owner.email, image: null };
      vi.stubEnv('PLAN_MODE', 'hosted');
      const started = await startSubscriptionAction({
        workspaceId: ws.id,
        term: 'year',
        seats: '2',
      });
      expect(started).toMatchObject({ ok: true, data: { amountPaise: 1_412_460 } });
      expect(await scheduleCancelAction({ workspaceId: ws.id, cancel: true })).toMatchObject({
        ok: false,
        code: 'CONFLICT',
      });
      expect(await startSubscriptionAction({ workspaceId: ws.id, term: 'week' })).toMatchObject({
        ok: false,
        code: 'VALIDATION',
      });

      vi.stubEnv('PLAN_MODE', 'self-hosted');
      expect(await startSubscriptionAction({ workspaceId: ws.id, term: 'month' })).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      });
      vi.unstubAllEnvs();
    });
  });

  describe('installation help', () => {
    const FORM = {
      name: 'Ravi Kumar',
      phone: '+91 98765 43210',
      legalName: 'Kumar Logistics LLP',
      gstin: '',
      addressLine1: '7 Ring Road',
      addressLine2: '',
      city: 'Jaipur',
      pin: '302001',
      stateCode: '08',
      email: 'Ravi@Kumar.example',
      provider: 'Hostinger VPS',
      serverDetails: 'Ubuntu 24.04, 4 GB memory, domain sign.kumar.example',
      preferredTime: 'Any weekday after 2 pm IST',
    };

    it('books, takes the payment, invoices the buyer and tells the operator once', async () => {
      const booking = installBookingSchema.parse(FORM);
      const { bookingId, checkout } = await createInstallBooking(sql, deps, { booking });
      // 1,999 plus 18%.
      expect(checkout.amountPaise).toBe(235_882);
      expect(checkout.prefill).toEqual({
        name: 'Kumar Logistics LLP',
        email: 'ravi@kumar.example',
      });
      expect(await notifyInstallBookings(sql, deps)).toBe(0);

      expect((await pay(null, checkout)).status).toBe('paid');
      const [row] = await sql<{ paid_at: Date | null }[]>`
        select paid_at from app_install_bookings where id = ${bookingId}`;
      expect(row!.paid_at).toEqual(now);
      expect(sent.filter((m) => m.meta?.kind === 'invoice').map((m) => m.to)).toEqual([
        'ravi@kumar.example',
      ]);

      const notices = await Promise.all([
        notifyInstallBookings(sql, deps),
        notifyInstallBookings(sql, deps),
      ]);
      expect(notices.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await notifyInstallBookings(sql, deps)).toBe(0);
      const [notice] = sent.filter((m) => m.meta?.kind === 'install_help_booking');
      expect(notice).toMatchObject({ to: 'ops@codevibe.example', replyTo: 'ravi@kumar.example' });
      expect(notice!.text).toContain('Hostinger VPS');
      expect(notice!.text).toContain('₹2,358.82');
    });

    it('tries the operator again after a failed send and waits without an address', async () => {
      const booking = installBookingSchema.parse(FORM);
      const { checkout } = await createInstallBooking(sql, deps, { booking });
      await pay(null, checkout);
      const silent = { ...deps, config: billingConfig({ ...ENV, OPERATOR_EMAIL: '' }) };
      expect(await notifyInstallBookings(sql, silent)).toBe(0);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const failing = {
        ...deps,
        mailer: {
          async send() {
            throw new Error('smtp down');
          },
        },
      };
      expect(await notifyInstallBookings(sql, failing)).toBe(0);
      error.mockRestore();
      expect(await notifyInstallBookings(sql, deps)).toBe(1);
    });

    it('cannot be confirmed as a workspace order, and is closed without payments', async () => {
      const ws = await workspace();
      const booking = installBookingSchema.parse(FORM);
      const { checkout } = await createInstallBooking(sql, deps, { booking });
      const payment = razorpay.pay(checkout.orderId);
      const err = await appError(
        confirmCheckout(sql, deps, {
          workspaceId: ws.id,
          razorpayOrderId: checkout.orderId,
          paymentId: payment.id,
          signature: 'x',
        }),
      );
      expect(err.code).toBe('NOT_FOUND');
      const closed = await appError(
        createInstallBooking(sql, { ...deps, config: billingConfig({}) }, { booking }),
      );
      expect(closed.message).toBe('Booking is not open yet.');
    });

    it('checks the form and refuses pasted credentials', () => {
      const bad = installBookingSchema.safeParse({
        ...FORM,
        serverDetails: 'root password: hunter2 on 10.0.0.1',
      });
      expect(bad.success).toBe(false);
      expect(bad.error!.issues[0]!.message).toContain('Do not put passwords or keys here');
      expect(installBookingSchema.safeParse({ ...FORM, stateCode: '99' }).success).toBe(false);
      expect(
        installBookingSchema.safeParse({ ...FORM, gstin: '06AANCC6406C1ZX' }).error!.issues[0]!
          .path,
      ).toEqual(['gstin']);
    });

    it('limits how many bookings one address can open', async () => {
      const at = new Date('2031-01-01T00:00:00Z');
      for (let i = 0; i < 4; i += 1) await enforceBookingLimit('203.0.113.9', at);
      expect((await appError(enforceBookingLimit('203.0.113.9', at))).code).toBe('CONFLICT');
      await enforceBookingLimit('203.0.113.10', at);
    });
  });
});
