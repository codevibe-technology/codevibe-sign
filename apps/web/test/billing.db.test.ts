import { createHmac, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { MailMessage } from '@codevibe_technology/sign-core';
import { memoryFileStore } from '@codevibe_technology/sign-server';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingDetails } from '@/lib/billing/details';
import type { Role } from '@/lib/roles';
import { listAudit } from '@/server/billing/audit';
import { billingConfig } from '@/server/billing/config';
import { createCreditsOrder, fulfilCredits } from '@/server/billing/credit-orders';
import {
  consumeCredit,
  creditBalance,
  creditHistory,
  grantCredits,
  releaseCredit,
  reserveCredit,
} from '@/server/billing/credits';
import { getBillingDetails, saveBillingDetails } from '@/server/billing/details';
import {
  finishInvoice,
  finishPendingInvoices,
  getInvoice,
  invoicePdf,
  listInvoices,
} from '@/server/billing/invoices';
import {
  PaymentMismatchError,
  confirmCheckout,
  createOrder,
  fulfilOrder,
  getOrder,
  handleRazorpayWebhook,
  registerFulfilment,
  type BillingDeps,
} from '@/server/billing/orders';
import { billingOverview } from '@/server/billing/overview';
import type { RazorpayClient, RazorpayPayment } from '@/server/billing/razorpay';
import { AppError } from '@/server/errors';
import { migrateAll } from '@/server/migrate';
import { createWorkspace } from '@/server/workspaces';

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; image: null } | null,
  sql: null as unknown,
  deps: null as unknown,
}));

vi.mock('@/server/auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/db', () => ({ db: () => state.sql }));
vi.mock('@/server/billing/runtime', () => ({ billingDeps: () => state.deps }));
vi.mock('@/server/client-address', () => ({ clientAddress: () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const url = process.env.DATABASE_URL;
const KEY_SECRET = 'key-secret-for-tests';
const WEBHOOK_SECRET = 'webhook-secret-for-tests';
const NOW = new Date('2026-11-23T10:00:00Z');

const ENV = {
  RAZORPAY_KEY_ID: 'rzp_live_TESTKEY123',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  INVOICE_SELLER_NAME: 'Codevibe Technology Private Limited',
  INVOICE_SELLER_GSTIN: '06AANCC6406C1ZX',
  INVOICE_SELLER_CIN: 'U62099HR2026PTC142917',
  INVOICE_SELLER_ADDRESS:
    '3rd Floor, Tower A 309, SAS Tower, Medicity, Sadar Bazar, Gurugram, Haryana 122001',
  LEEGALITY_API_KEY: 'token',
  LEEGALITY_PRIVATE_SALT: 'salt',
  LEEGALITY_WORKFLOW_ID: 'workflow',
  LEEGALITY_BASE_URL: 'https://app1.leegality.com/api',
  ESIGN_PROVIDER_COST_INR: '25',
  ESIGN_MARKUP_INR: '10',
};

const HARYANA: BillingDetails = {
  legalName: 'Acme Traders Private Limited',
  gstin: '06AANCC6406C1ZX',
  addressLine1: '12 MG Road',
  addressLine2: null,
  city: 'Gurugram',
  pin: '122001',
  stateCode: '06',
  email: 'accounts@acme.example',
};
const MAHARASHTRA: BillingDetails = {
  ...HARYANA,
  legalName: 'Bombay Paper Co',
  gstin: null,
  city: 'Mumbai',
  pin: '400001',
  stateCode: '27',
  email: 'pay@bombay.example',
};

/** A stand-in for Razorpay that keeps orders and payments in memory. */
function fakeRazorpay() {
  const orders = new Map<string, number>();
  const payments = new Map<string, RazorpayPayment>();
  let counter = 0;
  const client: RazorpayClient = {
    async createOrder(input) {
      const id = `order_${String(++counter).padStart(8, '0')}${randomUUID().slice(0, 6)}`;
      orders.set(id, input.amountPaise);
      return { id, amount: input.amountPaise, currency: 'INR', status: 'created' };
    },
    async fetchPayment(id) {
      const payment = payments.get(id);
      if (!payment) throw new Error('no such payment');
      return { ...payment };
    },
    async capturePayment(id, amountPaise) {
      const payment = payments.get(id);
      if (!payment || payment.amount !== amountPaise) throw new Error('cannot capture');
      payment.status = 'captured';
      return { ...payment };
    },
  };
  return {
    client,
    orders,
    payments,
    calls: { capture: 0 },
    /** Records a payment the way Razorpay would after Checkout. */
    pay(orderId: string, overrides: Partial<RazorpayPayment> = {}) {
      const payment: RazorpayPayment = {
        id: `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
        orderId,
        amount: orders.get(orderId) ?? 0,
        currency: 'INR',
        status: 'captured',
        ...overrides,
      };
      payments.set(payment.id, payment);
      return payment;
    },
  };
}

const checkoutSignature = (orderId: string, paymentId: string) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

function webhook(payment: RazorpayPayment, event = 'payment.captured') {
  const rawBody = JSON.stringify({
    event,
    payload: {
      payment: {
        entity: {
          id: payment.id,
          order_id: payment.orderId,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
        },
      },
    },
  });
  return {
    rawBody,
    signature: createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'),
    eventId: `evt_${randomUUID()}`,
  };
}

/** The text pdf-lib drew on the page: its hex strings, decoded. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  let text = '';
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const hex of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      text += `${Buffer.from(hex[1]!, 'hex').toString('latin1')}\n`;
    }
  }
  return text;
}

async function appError(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe.skipIf(!url)('billing against PostgreSQL', () => {
  const schema = `web_billing_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let razorpay: ReturnType<typeof fakeRazorpay>;
  let sent: MailMessage[];
  let deps: BillingDeps;
  let failMail = false;

  async function person(name = 'Asha') {
    const id = randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`;
    await sql`insert into auth_users (id, name, email) values (${id}, ${name}, ${email})`;
    return { id, email, name, image: null };
  }

  async function workspace(details: BillingDetails | null = HARYANA) {
    const owner = await person();
    const ws = await createWorkspace(
      sql,
      { name: 'Acme', userId: owner.id },
      { mode: 'hosted', freeOverrides: {} },
    );
    if (details)
      await saveBillingDetails(sql, { accountId: ws.accountId, userId: owner.id, details });
    return { ...ws, owner };
  }

  async function member(workspaceId: string, role: Role) {
    const user = await person(role);
    await sql`
      insert into app_members (workspace_id, user_id, role)
      values (${workspaceId}, ${user.id}, ${role})`;
    return user;
  }

  const buy = (
    ws: { accountId: string; owner: { id: string } },
    credits = 10,
    plan = 'free' as const,
  ) =>
    createCreditsOrder(sql, deps, { accountId: ws.accountId, userId: ws.owner.id, plan, credits });

  const confirm = (accountId: string, orderId: string, payment: RazorpayPayment) =>
    confirmCheckout(sql, deps, {
      accountId,
      razorpayOrderId: orderId,
      paymentId: payment.id,
      signature: checkoutSignature(orderId, payment.id),
    });

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 12, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0014_billing');
    state.sql = sql;
  });

  beforeEach(() => {
    razorpay = fakeRazorpay();
    sent = [];
    failMail = false;
    registerFulfilment('esign_credits', fulfilCredits);
    deps = {
      config: billingConfig(ENV),
      razorpay: razorpay.client,
      files: memoryFileStore(),
      mailer: {
        async send(message) {
          if (failMail) throw new Error('smtp down');
          sent.push(message);
        },
      },
      now: () => NOW,
    };
    state.deps = deps;
    state.user = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  describe('credit ledger', () => {
    it('grants once per reference', async () => {
      const ws = await workspace();
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
      expect(await grantCredits(sql, { accountId: ws.accountId, credits: 10, ref: 'ord_1' })).toBe(
        true,
      );
      expect(await grantCredits(sql, { accountId: ws.accountId, credits: 10, ref: 'ord_1' })).toBe(
        false,
      );
      expect(await grantCredits(sql, { accountId: ws.accountId, credits: 5, ref: 'ord_2' })).toBe(
        true,
      );
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 15, reserved: 0 });
      await expect(
        grantCredits(sql, { accountId: ws.accountId, credits: 0, ref: 'x' }),
      ).rejects.toThrow();
      await expect(
        grantCredits(sql, { accountId: ws.accountId, credits: 1.5, ref: 'x' }),
      ).rejects.toThrow();
    });

    it('reserves on start, consumes on success and releases on failure', async () => {
      const ws = await workspace();
      const at = { accountId: ws.accountId };
      await grantCredits(sql, { ...at, credits: 2, ref: 'ord_1' });

      expect(await reserveCredit(sql, { ...at, ref: 'esign_a' })).toBe(true);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 1, reserved: 1 });
      expect(await consumeCredit(sql, { ...at, ref: 'esign_a' })).toBe(true);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 1, reserved: 0 });

      expect(await reserveCredit(sql, { ...at, ref: 'esign_b' })).toBe(true);
      expect(await releaseCredit(sql, { ...at, ref: 'esign_b' })).toBe(true);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 1, reserved: 0 });

      expect(
        (await creditHistory(sql, ws.accountId)).map((e) => `${e.kind}:${e.ref}`).sort(),
      ).toEqual([
        'consume:esign_a',
        'grant:ord_1',
        'release:esign_b',
        'reserve:esign_a',
        'reserve:esign_b',
      ]);
    });

    it('ignores replays and settles a hold only once', async () => {
      const ws = await workspace();
      const at = { accountId: ws.accountId };
      await grantCredits(sql, { ...at, credits: 3, ref: 'ord_1' });

      expect(await reserveCredit(sql, { ...at, ref: 's1' })).toBe(true);
      expect(await reserveCredit(sql, { ...at, ref: 's1' })).toBe(true);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 2, reserved: 1 });

      expect(await consumeCredit(sql, { ...at, ref: 's1' })).toBe(true);
      expect(await consumeCredit(sql, { ...at, ref: 's1' })).toBe(false);
      expect(await releaseCredit(sql, { ...at, ref: 's1' })).toBe(false);
      expect(await reserveCredit(sql, { ...at, ref: 's1' })).toBe(true);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 2, reserved: 0 });

      expect(await reserveCredit(sql, { ...at, ref: 's2' })).toBe(true);
      expect(await releaseCredit(sql, { ...at, ref: 's2' })).toBe(true);
      expect(await releaseCredit(sql, { ...at, ref: 's2' })).toBe(false);
      expect(await consumeCredit(sql, { ...at, ref: 's2' })).toBe(false);
      expect(await reserveCredit(sql, { ...at, ref: 's2' })).toBe(false);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 2, reserved: 0 });

      expect(await consumeCredit(sql, { ...at, ref: 'never' })).toBe(false);
      expect(await releaseCredit(sql, { ...at, ref: 'never' })).toBe(false);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 2, reserved: 0 });
    });

    it('never goes below zero', async () => {
      const ws = await workspace();
      expect(await reserveCredit(sql, { accountId: ws.accountId, ref: 's1' })).toBe(false);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
      expect(await creditHistory(sql, ws.accountId)).toEqual([]);
      await expect(
        sql`update app_esign_credits set available = -1 where account_id = ${ws.accountId}`,
      ).rejects.toThrow(/check/);
    });

    it('gives exactly five of twenty parallel reservations a balance of five', async () => {
      const ws = await workspace();
      await grantCredits(sql, { accountId: ws.accountId, credits: 5, ref: 'ord_1' });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          reserveCredit(sql, { accountId: ws.accountId, ref: `esign_${i}` }),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(5);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 5 });
    });

    it('settles one hold once when consume and release race', async () => {
      const ws = await workspace();
      const at = { accountId: ws.accountId };
      await grantCredits(sql, { ...at, credits: 1, ref: 'ord_1' });
      await reserveCredit(sql, { ...at, ref: 's1' });
      const results = await Promise.all([
        consumeCredit(sql, { ...at, ref: 's1' }),
        releaseCredit(sql, { ...at, ref: 's1' }),
        consumeCredit(sql, { ...at, ref: 's1' }),
        releaseCredit(sql, { ...at, ref: 's1' }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const balance = await creditBalance(sql, ws.accountId);
      expect(balance.reserved).toBe(0);
      expect(balance.available).toBe(results[0] || results[2] ? 0 : 1);
    });

    it('rolls back with the caller transaction', async () => {
      const ws = await workspace();
      await sql
        .begin(async (tx) => {
          await grantCredits(tx, { accountId: ws.accountId, credits: 4, ref: 'ord_1' });
          throw new Error('undo');
        })
        .catch(() => undefined);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
    });

    it('keeps workspaces apart', async () => {
      const a = await workspace();
      const b = await workspace();
      await grantCredits(sql, { accountId: a.accountId, credits: 1, ref: 'ord_1' });
      expect(await reserveCredit(sql, { accountId: b.accountId, ref: 's1' })).toBe(false);
      expect(await reserveCredit(sql, { accountId: a.accountId, ref: 's1' })).toBe(true);
      expect(await consumeCredit(sql, { accountId: b.accountId, ref: 's1' })).toBe(false);
      expect(await creditBalance(sql, a.accountId)).toEqual({ available: 0, reserved: 1 });
    });
  });

  describe('billing details', () => {
    it('saves, replaces and audits', async () => {
      const ws = await workspace(null);
      expect(await getBillingDetails(sql, ws.accountId)).toBeNull();
      await saveBillingDetails(sql, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        details: HARYANA,
      });
      await saveBillingDetails(sql, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        details: MAHARASHTRA,
      });
      expect(await getBillingDetails(sql, ws.accountId)).toEqual(MAHARASHTRA);
      const audit = await listAudit(sql, { accountId: ws.accountId }, { prefix: 'billing.' });
      expect(audit.map((a) => a.action)).toEqual([
        'billing.details_updated',
        'billing.details_updated',
      ]);
      expect(audit[0]).toMatchObject({ actorId: ws.owner.id, data: { stateCode: '27' } });
    });
  });

  describe('credit orders', () => {
    it('prices a pack on the server and hands Checkout only what it needs', async () => {
      const ws = await workspace(HARYANA);
      const { order, checkout } = await buy(ws, 10);
      expect(order).toMatchObject({
        kind: 'esign_credits',
        status: 'created',
        mode: 'live',
        payload: { credits: 10 },
        lines: [
          {
            description: 'Aadhaar eSign credits × 10 @ ₹35',
            quantity: 10,
            unitPaise: 3500,
            amountPaise: 35_000,
          },
        ],
        tax: { kind: 'intra', cgstPaise: 3150, sgstPaise: 3150, igstPaise: 0, totalPaise: 41_300 },
      });
      expect(checkout).toEqual({
        orderId: order.razorpayOrderId,
        amountPaise: 41_300,
        currency: 'INR',
        keyId: 'rzp_live_TESTKEY123',
        name: 'Codevibe Technology Private Limited',
        description: '10 Aadhaar eSign credits',
        prefill: { name: HARYANA.legalName, email: HARYANA.email },
        testMode: false,
      });
      expect(JSON.stringify(checkout)).not.toContain(KEY_SECRET);
      expect(razorpay.orders.get(order.razorpayOrderId)).toBe(41_300);
    });

    it('charges IGST outside the seller state and the Cloud price on Cloud', async () => {
      const ws = await workspace(MAHARASHTRA);
      const { order } = await buy(ws, 50, 'cloud' as never);
      expect(order.lines[0]).toMatchObject({
        description: 'Aadhaar eSign credits × 50 @ ₹25',
        unitPaise: 2500,
        amountPaise: 125_000,
      });
      expect(order.tax).toMatchObject({ kind: 'inter', igstPaise: 22_500, totalPaise: 147_500 });
    });

    it('refuses with the field to fix', async () => {
      const bare = await workspace(null);
      const missing = await appError(buy(bare, 10));
      expect(missing).toMatchObject({ code: 'VALIDATION', field: 'billingDetails' });
      expect(missing.message).toMatch(/billing details/);

      const ws = await workspace();
      expect(await appError(buy(ws, 11))).toMatchObject({ code: 'VALIDATION', field: 'credits' });

      deps.config = billingConfig({ ...ENV, ESIGN_PROVIDER_COST_INR: '' });
      const unpriced = await appError(buy(ws, 10));
      expect(unpriced.code).toBe('CONFLICT');
      expect(unpriced.message).toMatch(/price .* has not been published/i);

      deps.config = billingConfig({ ...ENV, RAZORPAY_KEY_ID: 'rzp_test_TESTKEY123' });
      expect((await appError(buy(ws, 10))).message).toMatch(/test mode/);

      deps.config = billingConfig({ ...ENV, RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' });
      expect((await appError(buy(ws, 10))).message).toMatch(/not available yet/);
      expect(razorpay.orders.size).toBe(0);
    });

    it('says so when the payment service is down, without charging', async () => {
      const ws = await workspace();
      const { RazorpayError } = await import('@/server/billing/razorpay');
      razorpay.client.createOrder = async () => {
        throw new RazorpayError('The payment service answered 503', 503, true);
      };
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const err = await appError(buy(ws, 10));
      expect(err.message).toMatch(/Nothing was charged/);
      expect(log).toHaveBeenCalled();
      const rows = await sql`select id from app_billing_orders where account_id = ${ws.accountId}`;
      expect(rows).toHaveLength(0);
    });
  });

  describe('confirming a payment', () => {
    it('fulfils a captured payment: credits, invoice, email, audit', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      const outcome = await confirm(ws.accountId, order.razorpayOrderId, payment);
      expect(outcome).toMatchObject({ status: 'paid', kind: 'esign_credits', orderId: order.id });
      if (outcome.status !== 'paid') throw new Error('unreachable');
      expect(outcome.invoice.number).toMatch(/^CV-202627\d{4}$/);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 10, reserved: 0 });

      const paid = await getOrder(sql, ws.accountId, order.id);
      expect(paid).toMatchObject({ status: 'paid', razorpayPaymentId: payment.id, paidAt: NOW });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        to: HARYANA.email,
        subject: `Tax invoice ${outcome.invoice.number} from Codevibe Technology Private Limited`,
        meta: { kind: 'invoice', accountId: ws.accountId },
      });
      expect(sent[0]!.text).toContain('Aadhaar eSign credits × 10 @ ₹35');
      expect(sent[0]!.text).toContain('₹413');
      expect(sent[0]!.attachments).toHaveLength(1);
      expect(sent[0]!.attachments![0]).toMatchObject({
        filename: `${outcome.invoice.number}.pdf`,
        contentType: 'application/pdf',
      });

      const actions = (await listAudit(sql, { accountId: ws.accountId })).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'billing.order_created',
          'billing.payment_captured',
          'billing.invoice_issued',
          'credits.granted',
        ]),
      );
      const audit = JSON.stringify(await listAudit(sql, { accountId: ws.accountId }));
      expect(audit).not.toContain(KEY_SECRET);
    });

    it('changes nothing when asked twice', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      const first = await confirm(ws.accountId, order.razorpayOrderId, payment);
      const second = await confirm(ws.accountId, order.razorpayOrderId, payment);
      expect(second).toEqual(first);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 10, reserved: 0 });
      expect(await listInvoices(sql, ws.accountId)).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it('refuses a wrong signature before asking the payment service', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      const fetchPayment = vi.spyOn(razorpay.client, 'fetchPayment');
      const err = await appError(
        confirmCheckout(sql, deps, {
          accountId: ws.accountId,
          razorpayOrderId: order.razorpayOrderId,
          paymentId: payment.id,
          signature: checkoutSignature(order.razorpayOrderId, 'pay_someoneElse1'),
        }),
      );
      expect(err.code).toBe('VALIDATION');
      expect(fetchPayment).not.toHaveBeenCalled();
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
      expect((await getOrder(sql, ws.accountId, order.id))?.status).toBe('created');
    });

    it('does not trust a client that only says the payment succeeded', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId, { status: 'failed' });
      expect(await confirm(ws.accountId, order.razorpayOrderId, payment)).toEqual({
        status: 'failed',
      });
      const created = razorpay.pay(order.razorpayOrderId, { status: 'created' });
      expect(await confirm(ws.accountId, order.razorpayOrderId, created)).toEqual({
        status: 'pending',
      });
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
    });

    it('refuses a payment of another amount', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 200);
      const cheap = razorpay.pay(order.razorpayOrderId, { amount: 100 });
      await expect(confirm(ws.accountId, order.razorpayOrderId, cheap)).rejects.toBeInstanceOf(
        PaymentMismatchError,
      );
      const authorised = razorpay.pay(order.razorpayOrderId, { amount: 100, status: 'authorized' });
      await expect(confirm(ws.accountId, order.razorpayOrderId, authorised)).rejects.toBeInstanceOf(
        PaymentMismatchError,
      );
      expect(razorpay.payments.get(authorised.id)?.status).toBe('authorized');
      const rupees = razorpay.pay(order.razorpayOrderId, { currency: 'USD' });
      await expect(confirm(ws.accountId, order.razorpayOrderId, rupees)).rejects.toBeInstanceOf(
        PaymentMismatchError,
      );
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
      expect(await listInvoices(sql, ws.accountId)).toHaveLength(0);
    });

    it('refuses a payment that belongs to another order', async () => {
      const ws = await workspace();
      const small = await buy(ws, 10);
      const large = await buy(ws, 200);
      const payment = razorpay.pay(small.order.razorpayOrderId);
      await expect(
        confirm(ws.accountId, large.order.razorpayOrderId, payment),
      ).rejects.toBeInstanceOf(PaymentMismatchError);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
    });

    it('captures an authorised payment and then fulfils it', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 50);
      const payment = razorpay.pay(order.razorpayOrderId, { status: 'authorized' });
      const capture = vi.spyOn(razorpay.client, 'capturePayment');
      expect((await confirm(ws.accountId, order.razorpayOrderId, payment)).status).toBe('paid');
      expect(capture).toHaveBeenCalledWith(payment.id, order.tax.totalPaise);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 50, reserved: 0 });
    });

    it('looks the same for an order of another workspace as for none', async () => {
      const mine = await workspace();
      const theirs = await workspace();
      const { order } = await buy(theirs, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      const err = await appError(confirm(mine.accountId, order.razorpayOrderId, payment));
      expect(err.code).toBe('NOT_FOUND');
      expect((await appError(confirm(mine.accountId, 'order_doesNotExist', payment))).code).toBe(
        'NOT_FOUND',
      );
      expect(await creditBalance(sql, theirs.accountId)).toEqual({ available: 0, reserved: 0 });
      expect(await getOrder(sql, mine.accountId, order.id)).toBeNull();
    });

    it('refuses ids that are not ids', async () => {
      const ws = await workspace();
      const err = await appError(
        confirmCheckout(sql, deps, {
          accountId: ws.accountId,
          razorpayOrderId: "order_1' or '1'='1",
          paymentId: 'pay_../x',
          signature: 'ff',
        }),
      );
      expect(err.code).toBe('VALIDATION');
    });
  });

  describe('webhooks', () => {
    it('fulfils before the browser confirms, and the browser then finds it paid', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      expect(await handleRazorpayWebhook(sql, deps, webhook(payment))).toBe('processed');
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 10, reserved: 0 });
      expect((await confirm(ws.accountId, order.razorpayOrderId, payment)).status).toBe('paid');
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 10, reserved: 0 });
      expect(await listInvoices(sql, ws.accountId)).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it('changes nothing after the browser confirmed, under the same or a new event id', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      await confirm(ws.accountId, order.razorpayOrderId, payment);
      const delivery = webhook(payment);
      expect(await handleRazorpayWebhook(sql, deps, delivery)).toBe('processed');
      expect(await handleRazorpayWebhook(sql, deps, delivery)).toBe('duplicate');
      expect(await handleRazorpayWebhook(sql, deps, webhook(payment, 'order.paid'))).toBe(
        'processed',
      );
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 10, reserved: 0 });
      expect(await listInvoices(sql, ws.accountId)).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it('refuses a body whose signature does not match', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const delivery = webhook(razorpay.pay(order.razorpayOrderId));
      for (const forged of [
        { ...delivery, signature: 'a'.repeat(64) },
        { ...delivery, signature: null },
        { ...delivery, rawBody: delivery.rawBody.replace('41300', '1') },
      ]) {
        expect((await appError(handleRazorpayWebhook(sql, deps, forged))).code).toBe(
          'UNAUTHORIZED',
        );
      }
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
    });

    it('accepts and ignores what it cannot use', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const unknown = razorpay.pay('order_notOurs0001', { amount: 500 });
      expect(await handleRazorpayWebhook(sql, deps, webhook(unknown))).toBe('ignored');
      const failed = razorpay.pay(order.razorpayOrderId, { status: 'failed' });
      expect(await handleRazorpayWebhook(sql, deps, webhook(failed, 'payment.failed'))).toBe(
        'ignored',
      );
      const wrongAmount = razorpay.pay(order.razorpayOrderId, { amount: 1 });
      expect(await handleRazorpayWebhook(sql, deps, webhook(wrongAmount))).toBe('ignored');
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 0, reserved: 0 });
      const [mismatch] = await sql`
        select data from app_audit_log where action = 'billing.payment_mismatch'
          and target = ${order.razorpayOrderId}`;
      expect(mismatch).toBeDefined();
    });

    it('is switched off without a webhook secret', async () => {
      deps.config = billingConfig({ ...ENV, RAZORPAY_WEBHOOK_SECRET: '' });
      const err = await appError(
        handleRazorpayWebhook(sql, deps, { rawBody: '{}', signature: 'x', eventId: null }),
      );
      expect(err.code).toBe('NOT_FOUND');
    });
  });

  describe('fulfilment', () => {
    it('grants once and issues one invoice when two fulfilments race', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      const results = await Promise.all([
        confirm(ws.accountId, order.razorpayOrderId, payment),
        handleRazorpayWebhook(sql, deps, webhook(payment)),
        confirm(ws.accountId, order.razorpayOrderId, payment),
        handleRazorpayWebhook(sql, deps, webhook(payment, 'order.paid')),
      ]);
      expect(results).toHaveLength(4);
      const again = await fulfilOrder(sql, deps, order.razorpayOrderId, payment);
      expect(again.fresh).toBe(false);
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 10, reserved: 0 });
      expect(await listInvoices(sql, ws.accountId)).toHaveLength(1);
      expect(sent).toHaveLength(1);
      const grants = (await creditHistory(sql, ws.accountId)).filter((e) => e.kind === 'grant');
      expect(grants).toHaveLength(1);
    });

    it('numbers invoices without gaps or repeats when many are paid at once', async () => {
      const [before] = await sql<{ last_sequence: number }[]>`
        select last_sequence from app_invoice_counters where prefix = 'CV-202627'`;
      const start = before?.last_sequence ?? 0;
      const buyers = await Promise.all(Array.from({ length: 8 }, () => workspace()));
      const orders = await Promise.all(buyers.map((ws) => buy(ws, 10)));
      const outcomes = await Promise.all(
        orders.map(({ order }, i) =>
          confirm(buyers[i]!.accountId, order.razorpayOrderId, razorpay.pay(order.razorpayOrderId)),
        ),
      );
      const numbers = outcomes
        .map((o) => (o.status === 'paid' ? Number(o.invoice.number.slice(-4)) : -1))
        .sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => start + i + 1));
    });

    it('leaves no gap when a fulfilment fails', async () => {
      const ws = await workspace();
      const failing = await buy(ws, 10);
      registerFulfilment('esign_credits', async () => {
        throw new Error('handler broke');
      });
      await expect(
        confirm(
          ws.accountId,
          failing.order.razorpayOrderId,
          razorpay.pay(failing.order.razorpayOrderId),
        ),
      ).rejects.toThrow('handler broke');
      expect((await getOrder(sql, ws.accountId, failing.order.id))?.status).toBe('created');
      registerFulfilment('esign_credits', fulfilCredits);
      const [counter] = await sql<{ last_sequence: number }[]>`
        select last_sequence from app_invoice_counters where prefix = 'CV-202627'`;
      const next = await buy(ws, 10);
      const outcome = await confirm(
        ws.accountId,
        next.order.razorpayOrderId,
        razorpay.pay(next.order.razorpayOrderId),
      );
      if (outcome.status !== 'paid') throw new Error('unreachable');
      expect(Number(outcome.invoice.number.slice(-4))).toBe((counter?.last_sequence ?? 0) + 1);
    });

    it('starts a new series with the financial year', async () => {
      const ws = await workspace();
      deps.now = () => new Date('2027-03-31T18:30:00Z');
      const { order } = await buy(ws, 10);
      const outcome = await confirm(
        ws.accountId,
        order.razorpayOrderId,
        razorpay.pay(order.razorpayOrderId),
      );
      if (outcome.status !== 'paid') throw new Error('unreachable');
      expect(outcome.invoice.number).toMatch(/^CV-202728\d{4}$/);
    });

    it('keeps test payments out of the tax series', async () => {
      deps.config = billingConfig({
        ...ENV,
        RAZORPAY_KEY_ID: 'rzp_test_TESTKEY123',
        LEEGALITY_BASE_URL: 'https://sandbox.leegality.com/api',
      });
      const ws = await workspace();
      const { order, checkout } = await buy(ws, 10);
      expect(checkout.testMode).toBe(true);
      expect(order.mode).toBe('test');
      const outcome = await confirm(
        ws.accountId,
        order.razorpayOrderId,
        razorpay.pay(order.razorpayOrderId),
      );
      if (outcome.status !== 'paid') throw new Error('unreachable');
      expect(outcome.invoice.number).toMatch(/^T-2026-\d{4}$/);
      expect(sent[0]!.subject).toMatch(/^Test invoice T-2026-/);
      const pdf = await invoicePdf(sql, deps, ws.accountId, outcome.invoice.id);
      expect(pdfText(pdf!.bytes)).toContain('Not a tax document');
    });

    it('lets another kind of order plug in its own fulfilment, with no workspace', async () => {
      const delivered: string[] = [];
      registerFulfilment('install_help', async (_tx, order) => {
        delivered.push(String(order.payload.server));
      });
      const { order, checkout } = await createOrder(sql, deps, {
        accountId: null,
        kind: 'install_help',
        lines: [{ description: 'Installation help', quantity: 1, unitPaise: 199_900 }],
        payload: { server: 'vps-1' },
        buyer: MAHARASHTRA,
        createdBy: null,
        summary: 'Installation help',
      });
      expect(checkout.amountPaise).toBe(235_882);
      const payment = razorpay.pay(order.razorpayOrderId);
      const outcome = await confirmCheckout(sql, deps, {
        accountId: null,
        razorpayOrderId: order.razorpayOrderId,
        paymentId: payment.id,
        signature: checkoutSignature(order.razorpayOrderId, payment.id),
      });
      expect(outcome.status).toBe('paid');
      expect(delivered).toEqual(['vps-1']);
      expect(sent[0]!.to).toBe(MAHARASHTRA.email);
      if (outcome.status !== 'paid') throw new Error('unreachable');
      expect(await getInvoice(sql, null, outcome.invoice.id)).not.toBeNull();
      const ws = await workspace();
      expect(await getInvoice(sql, ws.accountId, outcome.invoice.id)).toBeNull();
    });

    it('keeps the order unpaid when its kind has no fulfilment', async () => {
      const ws = await workspace();
      const { order } = await createOrder(sql, deps, {
        accountId: ws.accountId,
        kind: 'extra_seats',
        lines: [{ description: 'Extra members', quantity: 2, unitPaise: 9900 }],
        payload: {},
        buyer: HARYANA,
        createdBy: ws.owner.id,
        summary: 'Extra members',
      });
      const holder = globalThis as unknown as { __cvsFulfilments: Map<string, unknown> };
      holder.__cvsFulfilments.delete('extra_seats');
      await expect(
        confirm(ws.accountId, order.razorpayOrderId, razorpay.pay(order.razorpayOrderId)),
      ).rejects.toThrow(/No fulfilment/);
      expect((await getOrder(sql, ws.accountId, order.id))?.status).toBe('created');
    });
  });

  describe('invoices', () => {
    it('renders a tax invoice with both parties, the split and the total in words', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const payment = razorpay.pay(order.razorpayOrderId);
      const outcome = await confirm(ws.accountId, order.razorpayOrderId, payment);
      if (outcome.status !== 'paid') throw new Error('unreachable');
      const pdf = await invoicePdf(sql, deps, ws.accountId, outcome.invoice.id);
      expect(pdf!.number).toBe(outcome.invoice.number);
      expect(Buffer.from(pdf!.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
      const text = pdfText(pdf!.bytes);
      for (const expected of [
        'ORIGINAL FOR RECIPIENT',
        outcome.invoice.number,
        '23 Nov 2026',
        'CODEVIBE TECHNOLOGY PRIVATE LIMITED',
        '06AANCC6406C1ZX',
        'AANCC6406C',
        'U62099HR2026PTC142917',
        'Acme Traders Private Limited',
        '06-HARYANA',
        'Aadhaar eSign credits × 10 @ Rs. 35',
        'SAC: 998319',
        'Rs. 350.00',
        'CGST 9.0%',
        'SGST 9.0%',
        'Rs. 31.50',
        'Rs. 413.00',
        'Total amount (in words): INR Four Hundred Thirteen Rupees Only.',
        `Paid via Razorpay on 23-11-2026 (${payment.id})`,
        'computer generated document',
      ]) {
        expect(text, expected).toContain(expected);
      }
      expect(text).not.toContain('IGST');
      expect(text).not.toMatch(/cost|markup|Leegality/i);
      expect(sent[0]!.attachments![0]!.content).toEqual(pdf!.bytes);
    });

    it('shows IGST and "Unregistered" for a buyer in another state without a GSTIN', async () => {
      const ws = await workspace(MAHARASHTRA);
      const { order } = await buy(ws, 10);
      const outcome = await confirm(
        ws.accountId,
        order.razorpayOrderId,
        razorpay.pay(order.razorpayOrderId, { method: 'card' }),
      );
      if (outcome.status !== 'paid') throw new Error('unreachable');
      const text = pdfText((await invoicePdf(sql, deps, ws.accountId, outcome.invoice.id))!.bytes);
      expect(text).toContain('IGST 18.0%');
      expect(text).toContain('63.00');
      expect(text).toContain('Unregistered');
      expect(text).toContain('Paid via Card on');
      expect(text).toContain('27-MAHARASHTRA');
      expect(text).not.toContain('CGST');
    });

    it('keeps the figures of the day even when details and prices change later', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const outcome = await confirm(
        ws.accountId,
        order.razorpayOrderId,
        razorpay.pay(order.razorpayOrderId),
      );
      if (outcome.status !== 'paid') throw new Error('unreachable');
      await saveBillingDetails(sql, {
        accountId: ws.accountId,
        userId: ws.owner.id,
        details: MAHARASHTRA,
      });
      deps.config = billingConfig({ ...ENV, ESIGN_PROVIDER_COST_INR: '90', GST_PERCENT: '28' });
      deps.files = memoryFileStore();
      const text = pdfText((await invoicePdf(sql, deps, ws.accountId, outcome.invoice.id))!.bytes);
      expect(text).toContain('Acme Traders Private Limited');
      expect(text).toContain('413.00');
      expect(text).toContain('CGST 9.0%');
    });

    it('draws a name in another script without failing', async () => {
      const ws = await workspace({ ...HARYANA, legalName: 'आशा ट्रेडर्स Pvt Ltd' });
      const { order } = await buy(ws, 10);
      const outcome = await confirm(
        ws.accountId,
        order.razorpayOrderId,
        razorpay.pay(order.razorpayOrderId),
      );
      if (outcome.status !== 'paid') throw new Error('unreachable');
      const text = pdfText((await invoicePdf(sql, deps, ws.accountId, outcome.invoice.id))!.bytes);
      expect(text).toContain('Pvt Ltd');
      expect(sent).toHaveLength(1);
    });

    it('keeps the payment when the email fails, and sends it once later', async () => {
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      failMail = true;
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const outcome = await confirm(
        ws.accountId,
        order.razorpayOrderId,
        razorpay.pay(order.razorpayOrderId),
      );
      expect(outcome.status).toBe('paid');
      expect(log).toHaveBeenCalled();
      expect(await creditBalance(sql, ws.accountId)).toEqual({ available: 10, reserved: 0 });
      if (outcome.status !== 'paid') throw new Error('unreachable');
      expect((await getInvoice(sql, ws.accountId, outcome.invoice.id))?.emailedAt).toBeNull();

      failMail = false;
      const [first, second] = await Promise.all([
        finishInvoice(sql, deps, outcome.invoice.id),
        finishInvoice(sql, deps, outcome.invoice.id),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(sent.filter((m) => m.to === HARYANA.email)).toHaveLength(1);
      expect(await finishInvoice(sql, deps, outcome.invoice.id)).toBe(false);
      expect((await getInvoice(sql, ws.accountId, outcome.invoice.id))?.emailedAt).toEqual(NOW);
    });

    it('picks up unfinished invoices from the timer', async () => {
      await sql`update app_invoices set emailed_at = now() where emailed_at is null`;
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      failMail = true;
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await confirm(ws.accountId, order.razorpayOrderId, razorpay.pay(order.razorpayOrderId));
      expect(await finishPendingInvoices(sql, deps)).toBe(0);
      failMail = false;
      expect(await finishPendingInvoices(sql, deps)).toBe(1);
      expect(await finishPendingInvoices(sql, deps)).toBe(0);
      expect(sent).toHaveLength(1);
    });

    it('lists a workspace its own invoices only', async () => {
      const a = await workspace();
      const b = await workspace(MAHARASHTRA);
      const orderA = await buy(a, 10);
      const orderB = await buy(b, 50);
      const paidA = await confirm(
        a.accountId,
        orderA.order.razorpayOrderId,
        razorpay.pay(orderA.order.razorpayOrderId),
      );
      await confirm(
        b.accountId,
        orderB.order.razorpayOrderId,
        razorpay.pay(orderB.order.razorpayOrderId),
      );
      if (paidA.status !== 'paid') throw new Error('unreachable');
      const overview = await billingOverview(sql, deps.config, {
        accountId: a.accountId,
        plan: 'free',
      });
      expect(overview.invoices).toHaveLength(1);
      expect(overview.invoices[0]).toMatchObject({
        id: paidA.invoice.id,
        kind: 'esign_credits',
        description: 'Aadhaar eSign credits × 10 @ ₹35',
        taxablePaise: 35_000,
        taxPaise: 6300,
        totalPaise: 41_300,
        test: false,
      });
      expect(overview.credits).toEqual({ available: 10, reserved: 0 });
      expect(overview.offer).toMatchObject({ unavailable: null, pricePaise: 3500 });
      expect(overview.details).toEqual(HARYANA);
      expect(await getInvoice(sql, b.accountId, paidA.invoice.id)).toBeNull();
      expect(await invoicePdf(sql, deps, b.accountId, paidA.invoice.id)).toBeNull();
    });
  });

  describe('permissions', () => {
    async function actions() {
      return import('@/server/actions/billing');
    }
    async function route() {
      return import('@/app/api/billing/workspaces/[workspaceId]/invoices/[invoiceId]/route');
    }
    const download = async (workspaceId: string, invoiceId: string) =>
      (await route()).GET(new Request('http://localhost/'), {
        params: Promise.resolve({ workspaceId, invoiceId }),
      });

    it('lets the owner of the account manage billing and nobody else', async () => {
      vi.stubEnv('PLAN_MODE', 'hosted');
      const ws = await workspace(null);
      const {
        saveBillingDetailsAction,
        createCreditsOrderAction,
        listInvoicesAction,
        creditHistoryAction,
      } = await actions();
      const form = { workspaceId: ws.id, ...HARYANA, gstin: HARYANA.gstin ?? '', addressLine2: '' };

      state.user = null;
      expect(await saveBillingDetailsAction(form)).toMatchObject({
        ok: false,
        code: 'UNAUTHORIZED',
      });

      for (const role of ['viewer', 'member'] as const) {
        state.user = await member(ws.id, role);
        expect(await saveBillingDetailsAction(form)).toMatchObject({
          ok: false,
          code: 'FORBIDDEN',
        });
        expect(await createCreditsOrderAction({ workspaceId: ws.id, credits: 10 })).toMatchObject({
          ok: false,
          code: 'FORBIDDEN',
        });
        expect(await listInvoicesAction({ workspaceId: ws.id })).toMatchObject({
          code: 'FORBIDDEN',
        });
        expect(await creditHistoryAction({ workspaceId: ws.id })).toMatchObject({
          code: 'FORBIDDEN',
        });
      }

      state.user = await person('Outsider');
      expect(await saveBillingDetailsAction(form)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect(await getBillingDetails(sql, ws.accountId)).toBeNull();

      // An admin, or another owner of the workspace, is not the one who pays for it.
      for (const role of ['admin', 'owner'] as const) {
        state.user = await member(ws.id, role);
        expect(await saveBillingDetailsAction(form)).toMatchObject({
          ok: false,
          code: 'FORBIDDEN',
        });
        expect(await createCreditsOrderAction({ workspaceId: ws.id, credits: 10 })).toMatchObject({
          ok: false,
          code: 'FORBIDDEN',
        });
        expect(await listInvoicesAction({ workspaceId: ws.id })).toMatchObject({
          code: 'FORBIDDEN',
        });
      }
      expect(await getBillingDetails(sql, ws.accountId)).toBeNull();

      state.user = ws.owner;
      expect(await saveBillingDetailsAction({ ...form, gstin: '06AANCC6406C1ZY' })).toMatchObject({
        ok: false,
        code: 'VALIDATION',
        field: 'gstin',
      });
      expect(await saveBillingDetailsAction(form)).toMatchObject({ ok: true });
      expect(await getBillingDetails(sql, ws.accountId)).toEqual(HARYANA);
    });

    it('runs a purchase end to end through the actions', async () => {
      vi.stubEnv('PLAN_MODE', 'hosted');
      const ws = await workspace();
      const {
        createCreditsOrderAction,
        confirmPaymentAction,
        creditHistoryAction,
        listInvoicesAction,
      } = await actions();
      state.user = ws.owner;
      const created = await createCreditsOrderAction({ workspaceId: ws.id, credits: '50' });
      if (!created.ok) throw new Error(created.error);
      expect(created.data).toMatchObject({ amountPaise: 206_500, keyId: 'rzp_live_TESTKEY123' });
      expect(JSON.stringify(created)).not.toContain(KEY_SECRET);

      const payment = razorpay.pay(created.data.orderId);
      const confirmed = await confirmPaymentAction({
        workspaceId: ws.id,
        orderId: created.data.orderId,
        paymentId: payment.id,
        signature: checkoutSignature(created.data.orderId, payment.id),
      });
      expect(confirmed).toMatchObject({
        ok: true,
        data: { status: 'paid', kind: 'esign_credits', credits: { available: 50, reserved: 0 } },
      });

      const other = await workspace();
      state.user = other.owner;
      expect(
        await confirmPaymentAction({
          workspaceId: other.id,
          orderId: created.data.orderId,
          paymentId: payment.id,
          signature: checkoutSignature(created.data.orderId, payment.id),
        }),
      ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect(await listInvoicesAction({ workspaceId: other.id })).toEqual({ ok: true, data: [] });

      state.user = ws.owner;
      const history = await creditHistoryAction({ workspaceId: ws.id });
      expect(history).toMatchObject({
        ok: true,
        data: {
          balance: { available: 50, reserved: 0 },
          entries: [{ kind: 'grant', credits: 50 }],
        },
      });
      const body = JSON.stringify([created, confirmed, history]);
      expect(body).not.toMatch(/cost|markup/i);
    });

    it('is not there at all on a self-hosted install', async () => {
      vi.stubEnv('PLAN_MODE', 'self-hosted');
      const ws = await workspace(null);
      const all = await actions();
      state.user = ws.owner;
      const answers = [
        await all.saveBillingDetailsAction({
          workspaceId: ws.id,
          ...HARYANA,
          gstin: HARYANA.gstin ?? '',
          addressLine2: '',
        }),
        await all.createCreditsOrderAction({ workspaceId: ws.id, credits: 10 }),
        await all.confirmPaymentAction({
          workspaceId: ws.id,
          orderId: 'order_ABCDEFGHIJKLMN',
          paymentId: 'pay_ABCDEFGHIJKLMN',
          signature: 'a'.repeat(64),
        }),
        await all.listInvoicesAction({ workspaceId: ws.id }),
        await all.creditHistoryAction({ workspaceId: ws.id }),
      ];
      for (const answer of answers) expect(answer).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect(await getBillingDetails(sql, ws.accountId)).toBeNull();

      const { POST } = await import('@/app/api/billing/razorpay/webhook/route');
      const hook = await POST(
        new Request('http://localhost/api/billing/razorpay/webhook', {
          method: 'POST',
          body: '{}',
        }),
      );
      expect(hook.status).toBe(404);
      vi.unstubAllEnvs();
    });

    it('serves an invoice file to the owner of its account and 404s everyone else', async () => {
      vi.stubEnv('PLAN_MODE', 'hosted');
      const ws = await workspace();
      const { order } = await buy(ws, 10);
      const outcome = await confirm(
        ws.accountId,
        order.razorpayOrderId,
        razorpay.pay(order.razorpayOrderId),
      );
      if (outcome.status !== 'paid') throw new Error('unreachable');
      const other = await workspace();

      state.user = null;
      expect((await download(ws.id, outcome.invoice.id)).status).toBe(404);
      for (const role of ['member', 'admin', 'owner'] as const) {
        state.user = await member(ws.id, role);
        expect((await download(ws.id, outcome.invoice.id)).status).toBe(404);
      }
      state.user = other.owner;
      expect((await download(ws.id, outcome.invoice.id)).status).toBe(404);
      expect((await download(other.id, outcome.invoice.id)).status).toBe(404);

      state.user = ws.owner;
      vi.stubEnv('PLAN_MODE', 'self-hosted');
      expect((await download(ws.id, outcome.invoice.id)).status).toBe(404);
      vi.stubEnv('PLAN_MODE', 'hosted');
      const response = await download(ws.id, outcome.invoice.id);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${outcome.invoice.number}.pdf"`,
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(
        Buffer.from(await response.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
      expect((await download(ws.id, 'inv_missing')).status).toBe(404);
    });
  });
});
