import 'server-only';
import type { FileStore, Mailer } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import type { BillingDetails } from '@/lib/billing/details';
import { computeTax, type TaxBreakdown } from '@/lib/billing/gst';
import { invoiceNumber, seriesPrefix } from '@/lib/billing/invoice-series';
import type { Paise } from '@/lib/billing/money';
import { randomId } from '../crypto';
import { AppError } from '../errors';
import { recordAudit } from './audit';
import {
  paymentsConfigured,
  type BillingConfig,
  type RazorpayConfig,
  type SellerConfig,
} from './config';
import type { InvoiceAssets, InvoiceLine } from './invoice-pdf';
import { finishInvoice } from './invoices';
import { queueOperatorNotice, type NoticeData } from './notices';
import {
  RazorpayError,
  isRazorpayId,
  parseWebhook,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type RazorpayClient,
  type RazorpayPayment,
  type RazorpayWebhook,
} from './razorpay';

type Sql = postgres.Sql | postgres.TransactionSql;
type Tx = postgres.TransactionSql;

/** What the billing code needs from outside: settings, the payment service, files, mail, time. */
export interface BillingDeps {
  config: BillingConfig;
  /** Null when no keys are set. */
  razorpay: RazorpayClient | null;
  files: FileStore;
  mailer: Mailer;
  now: () => Date;
  /** Fonts, images and the seal for invoice files; without it invoices are plain and unsigned. */
  invoice?: InvoiceRendering | undefined;
}

export interface InvoiceRendering {
  assets: () => Promise<InvoiceAssets>;
  /** Applies the install's digital seal to a rendered invoice. */
  seal?: ((pdf: Uint8Array, at: Date) => Promise<Uint8Array>) | undefined;
}

export const ORDER_KINDS = [
  'esign_credits',
  'cloud_subscription',
  'extra_seats',
  'install_help',
] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];
/**
 * `paid_unapplied`: money arrived for an order that could no longer be honoured, so nothing was
 * delivered and the operator refunds it. `refunded`: the payment went back to the buyer.
 */
export type OrderStatus = 'created' | 'paid' | 'failed' | 'expired' | 'paid_unapplied' | 'refunded';

/** Why a captured payment delivered nothing. */
export type UnappliedReason =
  | 'expired'
  | 'test_order'
  | 'term_changed'
  | 'seat_limit'
  | 'plan_managed';
export type OrderPayload = Record<string, string | number | boolean | null>;

export interface BillingOrder {
  id: string;
  /** Null for a purchase made without an account. */
  accountId: string | null;
  kind: OrderKind;
  payload: OrderPayload;
  lines: InvoiceLine[];
  buyer: BillingDetails;
  seller: SellerConfig;
  sac: string;
  tax: TaxBreakdown;
  status: OrderStatus;
  mode: 'test' | 'live';
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  /** How the payment was made, for example `upi`; null when the payment service did not say. */
  paymentMethod: string | null;
  createdBy: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

/** What the browser hands to Razorpay Checkout. Holds the public key id only. */
export interface CheckoutSession {
  orderId: string;
  amountPaise: Paise;
  currency: 'INR';
  keyId: string;
  /** The seller, shown as the merchant name. */
  name: string;
  description: string;
  prefill: { name: string; email: string };
  testMode: boolean;
}

/**
 * Delivers what a paid order bought, inside the transaction that marks it paid. It runs once
 * per order; throwing leaves the order unpaid so the payment is tried again. Answering
 * `{ unapplied }`, having changed nothing, says the order can no longer be honoured: the
 * payment is kept apart for a refund and no invoice is issued.
 */
export type Fulfilment = (
  tx: Tx,
  order: BillingOrder,
  context: { now: Date },
) => Promise<void | { unapplied: UnappliedReason }>;

/**
 * Takes back what a refunded order delivered, as far as it is still there, inside the
 * transaction that marks the order refunded. What it answers goes into the audit row and the
 * operator's notice.
 */
export type Reversal = (
  tx: Tx,
  order: BillingOrder,
  context: { now: Date },
) => Promise<NoticeData | void>;

const holder = globalThis as unknown as {
  __cvsFulfilments?: Map<OrderKind, Fulfilment>;
  __cvsReversals?: Map<OrderKind, Reversal>;
};
const fulfilments = () => (holder.__cvsFulfilments ??= new Map());
const reversals = () => (holder.__cvsReversals ??= new Map());

/** Says what paying for an order of `kind` delivers. One handler per kind; the last one wins. */
export function registerFulfilment(kind: OrderKind, handler: Fulfilment): void {
  fulfilments().set(kind, handler);
}

/** Says what a refund of an order of `kind` takes back. */
export function registerReversal(kind: OrderKind, handler: Reversal): void {
  reversals().set(kind, handler);
}

interface OrderRow {
  id: string;
  account_id: string | null;
  kind: OrderKind;
  payload: OrderPayload;
  lines: InvoiceLine[];
  buyer: BillingDetails;
  seller: SellerConfig;
  sac: string;
  gst_percent: string;
  taxable_paise: string;
  cgst_paise: string;
  sgst_paise: string;
  igst_paise: string;
  total_paise: string;
  status: OrderStatus;
  mode: 'test' | 'live';
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  payment_method?: string | null;
  unapplied_reason?: UnappliedReason | null;
  created_by: string | null;
  created_at: Date;
  paid_at: Date | null;
}

function toOrder(row: OrderRow): BillingOrder {
  const gstPercent = Number(row.gst_percent);
  const cgstPaise = Number(row.cgst_paise);
  const sgstPaise = Number(row.sgst_paise);
  const igstPaise = Number(row.igst_paise);
  const intra = row.seller.stateCode === row.buyer.stateCode;
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    payload: row.payload,
    lines: row.lines,
    buyer: row.buyer,
    seller: row.seller,
    sac: row.sac,
    tax: {
      kind: intra ? 'intra' : 'inter',
      taxablePaise: Number(row.taxable_paise),
      cgstPaise,
      sgstPaise,
      igstPaise,
      taxPaise: cgstPaise + sgstPaise + igstPaise,
      totalPaise: Number(row.total_paise),
      cgstPercent: intra ? gstPercent / 2 : 0,
      sgstPercent: intra ? gstPercent / 2 : 0,
      igstPercent: intra ? 0 : gstPercent,
    },
    status: row.status,
    mode: row.mode,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    paymentMethod: row.payment_method ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

const NOT_CONFIGURED = 'Payments are not available here yet.';

function ready(deps: BillingDeps): {
  razorpay: RazorpayClient;
  keys: RazorpayConfig;
  seller: SellerConfig;
} {
  if (!paymentsConfigured(deps.config) || !deps.razorpay) {
    throw new AppError('CONFLICT', NOT_CONFIGURED);
  }
  return { razorpay: deps.razorpay, keys: deps.config.razorpay, seller: deps.config.seller };
}

function providerFailure(err: unknown): never {
  if (err instanceof RazorpayError) {
    console.error('[billing] payment service', err.message);
    throw new AppError(
      'CONFLICT',
      'The payment service did not answer. Nothing was charged; try again in a moment.',
    );
  }
  throw err;
}

export interface NewOrder {
  accountId: string | null;
  kind: OrderKind;
  /** What the invoice lists. Amounts come from the server's own prices, never from a request. */
  lines: { description: string; quantity: number; unitPaise: Paise }[];
  payload: OrderPayload;
  buyer: BillingDetails;
  createdBy: string | null;
  /** One line for the payment window, for example "50 Aadhaar eSign credits". */
  summary: string;
  ip?: string | null;
  /** Rows that must exist exactly when the order does, written in the same transaction. */
  alongside?: (tx: Tx, orderId: string) => Promise<void>;
}

/**
 * Prices an order, opens it with the payment service and stores it. The total, tax included,
 * is the amount the payment service will collect and the amount the invoice will show.
 */
export async function createOrder(
  sql: postgres.Sql,
  deps: BillingDeps,
  input: NewOrder,
): Promise<{ order: BillingOrder; checkout: CheckoutSession }> {
  const { razorpay, keys, seller } = ready(deps);
  const lines: InvoiceLine[] = input.lines.map((line) => {
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      !Number.isSafeInteger(line.unitPaise) ||
      line.unitPaise < 1
    ) {
      throw new Error('An order line needs a whole quantity and a price in paise');
    }
    return { ...line, amountPaise: line.quantity * line.unitPaise };
  });
  const tax = computeTax({
    taxablePaise: lines.reduce((sum, line) => sum + line.amountPaise, 0),
    gstPercent: deps.config.gstPercent,
    sellerStateCode: seller.stateCode,
    buyerStateCode: input.buyer.stateCode,
  });
  const id = randomId('ord');
  const remote = await razorpay
    .createOrder({
      amountPaise: tax.totalPaise,
      receipt: id,
      notes: { kind: input.kind, ...(input.accountId ? { account: input.accountId } : {}) },
    })
    .catch(providerFailure);

  const createdAt = deps.now();
  const [row] = await sql.begin(async (tx) => {
    const rows = await tx<OrderRow[]>`
      insert into app_billing_orders (
        id, account_id, kind, payload, lines, buyer, seller, sac, gst_percent, taxable_paise,
        cgst_paise, sgst_paise, igst_paise, total_paise, mode, razorpay_order_id, created_by,
        created_at, updated_at
      ) values (
        ${id}, ${input.accountId}, ${input.kind}, ${tx.json(input.payload)},
        ${tx.json(lines as never)}, ${tx.json(input.buyer as never)}, ${tx.json(seller as never)},
        ${deps.config.sac}, ${deps.config.gstPercent}, ${tax.taxablePaise}, ${tax.cgstPaise},
        ${tax.sgstPaise}, ${tax.igstPaise}, ${tax.totalPaise}, ${keys.mode}, ${remote.id},
        ${input.createdBy}, ${createdAt}, ${createdAt}
      )
      returning *`;
    await input.alongside?.(tx, id);
    await recordAudit(tx, {
      accountId: input.accountId,
      actorId: input.createdBy,
      action: 'billing.order_created',
      target: id,
      data: { kind: input.kind, totalPaise: tax.totalPaise, mode: keys.mode },
      ip: input.ip ?? null,
    });
    return rows;
  });
  return {
    order: toOrder(row!),
    checkout: {
      orderId: remote.id,
      amountPaise: tax.totalPaise,
      currency: 'INR',
      keyId: keys.keyId,
      name: seller.name,
      description: input.summary,
      prefill: { name: input.buyer.legalName, email: input.buyer.email },
      testMode: keys.mode === 'test',
    },
  };
}

export interface IssuedInvoice {
  id: string;
  number: string;
}

export interface FulfilmentResult {
  order: BillingOrder;
  /** Null when the payment was not applied: nothing was delivered, so nothing is invoiced. */
  invoice: IssuedInvoice | null;
  /** False when the order had been settled before this call. */
  fresh: boolean;
  /** Why the payment delivered nothing, when it did not. */
  unapplied: UnappliedReason | null;
}

/** The payment does not belong to the order, or is not for its exact amount. */
export class PaymentMismatchError extends AppError {
  constructor() {
    super(
      'CONFLICT',
      'This payment does not match the order. Nothing was added; write to us with the payment reference if money left your account.',
    );
    this.name = 'PaymentMismatchError';
  }
}

/**
 * Why a payment for this order must not deliver anything, before its kind is even asked: the
 * order was opened with test keys on an install that is now live, or the payment was made
 * after the order's prices stopped standing. A payment made in time counts however late the
 * news of it arrives.
 */
function refusedUpFront(
  config: BillingConfig,
  order: BillingOrder,
  payment: RazorpayPayment,
  now: Date,
): UnappliedReason | null {
  if (config.live && order.mode !== 'live') return 'test_order';
  const paidAt = payment.createdAt ?? now;
  if (paidAt.getTime() - order.createdAt.getTime() > config.orderWindowMs) return 'expired';
  return null;
}

/**
 * One lock for every invoice number, taken before the clock is read, so numbers, dates and
 * the financial year in the prefix all run in the same order.
 */
async function nextInvoice(tx: Tx, deps: BillingDeps, order: BillingOrder) {
  await tx`select pg_advisory_xact_lock(hashtext('cvs_invoice_number'))`;
  const issuedAt = deps.now();
  // Test payments get their own series, so the tax series has no gaps and no test documents.
  const prefix =
    order.mode === 'test'
      ? seriesPrefix('T-{FYS}-', issuedAt)
      : seriesPrefix(deps.config.series, issuedAt);
  const [row] = await tx<{ last_sequence: number }[]>`
    insert into app_invoice_counters (prefix, last_sequence) values (${prefix}, 1)
    on conflict (prefix) do update set last_sequence = app_invoice_counters.last_sequence + 1
    returning last_sequence`;
  return { number: invoiceNumber(prefix, row!.last_sequence), issuedAt };
}

/**
 * Marks an order paid, delivers what it bought and issues its invoice, all in one transaction
 * with the order row locked. Safe to call any number of times, from the browser confirmation
 * and from webhooks at once: only the first call does anything. A payment for an order that
 * can no longer be honoured is recorded as `paid_unapplied` instead: nothing is delivered, no
 * invoice is issued and the operator is told to refund it.
 */
export async function fulfilOrder(
  sql: postgres.Sql,
  deps: BillingDeps,
  razorpayOrderId: string,
  payment: RazorpayPayment,
): Promise<FulfilmentResult> {
  const now = deps.now();
  return sql.begin(async (tx) => {
    const [row] = await tx<OrderRow[]>`
      select * from app_billing_orders where razorpay_order_id = ${razorpayOrderId} for update`;
    if (!row) throw new AppError('NOT_FOUND', 'Order not found');
    const order = toOrder(row);
    if (
      order.status === 'paid' ||
      order.status === 'paid_unapplied' ||
      order.status === 'refunded'
    ) {
      const [invoice] = await tx<IssuedInvoice[]>`
        select id, number from app_invoices where order_id = ${order.id}`;
      return {
        order,
        invoice: invoice ?? null,
        fresh: false,
        unapplied: invoice ? null : (row.unapplied_reason ?? 'expired'),
      };
    }
    if (
      payment.status !== 'captured' ||
      payment.orderId !== order.razorpayOrderId ||
      payment.amount !== order.tax.totalPaise ||
      payment.currency !== 'INR'
    ) {
      throw new PaymentMismatchError();
    }
    const handler = fulfilments().get(order.kind);
    if (!handler) throw new Error(`No fulfilment is registered for ${order.kind} orders`);

    const [paid] = await tx<OrderRow[]>`
      update app_billing_orders
      set status = 'paid', razorpay_payment_id = ${payment.id},
        payment_method = ${payment.method ?? null}, paid_at = ${now}, updated_at = ${now}
      where id = ${order.id}
      returning *`;
    const paidOrder = toOrder(paid!);
    const unapplied =
      refusedUpFront(deps.config, order, payment, now) ??
      (await handler(tx, paidOrder, { now }))?.unapplied ??
      null;
    if (unapplied) {
      const [kept] = await tx<OrderRow[]>`
        update app_billing_orders
        set status = 'paid_unapplied', unapplied_reason = ${unapplied}
        where id = ${order.id}
        returning *`;
      await recordAudit(tx, {
        accountId: order.accountId,
        action: 'billing.payment_unapplied',
        target: order.id,
        data: { paymentId: payment.id, totalPaise: order.tax.totalPaise, reason: unapplied },
      });
      await queueOperatorNotice(tx, {
        kind: 'payment_unapplied',
        orderId: order.id,
        accountId: order.accountId,
        data: { reason: unapplied },
      });
      return { order: toOrder(kept!), invoice: null, fresh: true, unapplied };
    }
    const { number, issuedAt } = await nextInvoice(tx, deps, paidOrder);
    const invoice = { id: randomId('inv'), number };
    await tx`
      insert into app_invoices (id, number, order_id, account_id, issued_at)
      values (${invoice.id}, ${number}, ${order.id}, ${order.accountId}, ${issuedAt})`;
    await recordAudit(tx, {
      accountId: order.accountId,
      action: 'billing.payment_captured',
      target: order.id,
      data: { paymentId: payment.id, totalPaise: order.tax.totalPaise, mode: order.mode },
    });
    await recordAudit(tx, {
      accountId: order.accountId,
      action: 'billing.invoice_issued',
      target: invoice.id,
      data: { number, orderId: order.id, totalPaise: order.tax.totalPaise },
    });
    return { order: paidOrder, invoice, fresh: true, unapplied: null };
  });
}

export type CheckoutOutcome =
  | { status: 'paid'; orderId: string; kind: OrderKind; invoice: IssuedInvoice }
  /** The payment exists but is not captured yet; the webhook finishes it. */
  | { status: 'pending' }
  | { status: 'failed' }
  /**
   * The order could no longer be honoured. `charged` says whether money was taken (and will
   * be refunded) or the payment was left uncaptured.
   */
  | {
      status: 'unapplied';
      orderId: string;
      kind: OrderKind;
      reason: UnappliedReason;
      charged: boolean;
    };

const UNVERIFIED =
  'This payment could not be verified. If money left your account it will be confirmed shortly; nothing needs to be paid again.';

/**
 * Confirms what the browser reports after Razorpay Checkout. The signature proves the pair of
 * ids came from the payment service; the payment is then read from the service itself, and only
 * a captured payment for this order and its exact amount is fulfilled.
 */
export async function confirmCheckout(
  sql: postgres.Sql,
  deps: BillingDeps,
  input: {
    /** The workspace the caller acts in, or null for a public purchase. */
    accountId: string | null;
    razorpayOrderId: string;
    paymentId: string;
    signature: string;
  },
  afterFulfil: (result: FulfilmentResult) => Promise<void> = (result) =>
    finishInvoiceQuietly(sql, deps, result),
): Promise<CheckoutOutcome> {
  const { razorpay, keys } = ready(deps);
  if (!isRazorpayId(input.razorpayOrderId) || !isRazorpayId(input.paymentId)) {
    throw new AppError('VALIDATION', UNVERIFIED);
  }
  const [row] = await sql<OrderRow[]>`
    select * from app_billing_orders
    where razorpay_order_id = ${input.razorpayOrderId}
      and account_id is not distinct from ${input.accountId}`;
  if (!row) throw new AppError('NOT_FOUND', 'Order not found');
  if (!verifyCheckoutSignature({ ...input, orderId: row.razorpay_order_id }, keys.keySecret)) {
    throw new AppError('VALIDATION', UNVERIFIED);
  }
  let payment = await razorpay.fetchPayment(input.paymentId).catch(providerFailure);
  if (payment.orderId !== row.razorpay_order_id) throw new PaymentMismatchError();
  if (payment.status === 'authorized') {
    if (payment.amount !== Number(row.total_paise)) throw new PaymentMismatchError();
    // An order that cannot be honoured any more is not captured, so no money is taken.
    const order = toOrder(row);
    const refused =
      order.status === 'created' || order.status === 'expired'
        ? refusedUpFront(deps.config, order, payment, deps.now())
        : null;
    if (refused) {
      return {
        status: 'unapplied',
        orderId: order.id,
        kind: order.kind,
        reason: refused,
        charged: false,
      };
    }
    payment = await razorpay
      .capturePayment(payment.id, payment.amount)
      // Another request or the account's auto-capture may have captured it first.
      .catch(() => razorpay.fetchPayment(input.paymentId).catch(providerFailure));
  }
  if (payment.status === 'failed') return { status: 'failed' };
  if (payment.status !== 'captured') return { status: 'pending' };
  const result = await fulfilOrder(sql, deps, row.razorpay_order_id, payment);
  if (!result.invoice) {
    return {
      status: 'unapplied',
      orderId: result.order.id,
      kind: result.order.kind,
      reason: result.unapplied ?? 'expired',
      charged: true,
    };
  }
  if (result.fresh) await afterFulfil(result);
  return {
    status: 'paid',
    orderId: result.order.id,
    kind: result.order.kind,
    invoice: result.invoice,
  };
}

const UNAPPLIED_WHY: Record<UnappliedReason, string> = {
  expired: 'the order had expired before it was paid',
  test_order: 'the order was opened while payments were in test mode',
  term_changed: 'the Cloud term changed after the order was opened',
  seat_limit: 'it would go over the most extra members a workspace can have',
  plan_managed: 'the plan of this workspace is managed by our team',
};

/** What to tell the buyer whose payment delivered nothing. */
export const unappliedMessage = (reason: UnappliedReason, charged: boolean) =>
  charged
    ? `Your payment was received but could not be applied, because ${UNAPPLIED_WHY[reason]}. Nothing was added and no invoice was issued. We have been told and will refund it; you do not need to do anything.`
    : `This order can no longer be paid, because ${UNAPPLIED_WHY[reason]}. No money was taken; a hold on your account, if any, is released by your bank. Start again from this page.`;

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';

/** Webhook bodies are a few kilobytes; larger ones are refused before they are read. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

const FULFILLING_EVENTS = new Set(['payment.captured', 'order.paid']);

/**
 * Handles a Razorpay webhook. Throws `UNAUTHORIZED` for a body whose signature does not match.
 * A delivery seen before answers `duplicate`; fulfilment itself is idempotent as well, so a
 * replay under a new event id still changes nothing.
 */
export async function handleRazorpayWebhook(
  sql: postgres.Sql,
  deps: BillingDeps,
  input: { rawBody: string; signature: string | null; eventId: string | null },
  afterFulfil: (result: FulfilmentResult) => Promise<void> = (result) =>
    finishInvoiceQuietly(sql, deps, result),
): Promise<WebhookOutcome> {
  const secret = deps.config.razorpay?.webhookSecret;
  if (!secret) throw new AppError('NOT_FOUND', 'Webhooks are not set up');
  if (!input.signature || !verifyWebhookSignature(input.rawBody, input.signature, secret)) {
    throw new AppError('UNAUTHORIZED', 'The webhook signature does not match');
  }
  const webhook = parseWebhook(input.rawBody);
  if (!webhook) return 'ignored';
  const eventId = input.eventId && /^[\w.:-]{1,128}$/.test(input.eventId) ? input.eventId : null;
  if (eventId) {
    const [seen] = await sql`select 1 from app_razorpay_events where event_id = ${eventId}`;
    if (seen) return 'duplicate';
  }
  let outcome: WebhookOutcome = 'ignored';
  const { payment, orderId } = webhook;
  if (FULFILLING_EVENTS.has(webhook.event) && payment?.status === 'captured' && orderId) {
    const [known] = await sql`
      select 1 from app_billing_orders where razorpay_order_id = ${orderId}`;
    if (known) {
      try {
        const result = await fulfilOrder(sql, deps, orderId, payment);
        if (result.fresh && result.invoice) await afterFulfil(result);
        outcome = 'processed';
      } catch (err) {
        if (!(err instanceof PaymentMismatchError)) throw err;
        // Retrying cannot fix a payment that does not match, so the delivery is accepted.
        await recordAudit(sql, {
          action: 'billing.payment_mismatch',
          target: orderId,
          data: { paymentId: payment.id, amount: payment.amount },
        });
      }
    }
  }
  if (await reverseFromWebhook(sql, deps, webhook)) outcome = 'processed';
  if (eventId) {
    await sql`
      insert into app_razorpay_events (event_id, event) values (${eventId}, ${webhook.event})
      on conflict (event_id) do nothing`;
  }
  return outcome;
}

const NOTICE_ONLY: Record<string, 'refund_started' | 'payment_disputed'> = {
  'refund.created': 'refund_started',
  'payment.dispute.created': 'payment_disputed',
};
const REVERSING: Record<string, 'payment_refunded' | 'dispute_lost'> = {
  'refund.processed': 'payment_refunded',
  'payment.dispute.lost': 'dispute_lost',
};

/**
 * Acts on a refund or a dispute. A refund processed in full, or a lost dispute, marks the
 * order refunded and takes back what it delivered as far as that is still unused; anything
 * else only tells the operator. Either way the order row is locked and the event leaves an
 * audit row. False when the event is not about a payment of one of our orders.
 */
async function reverseFromWebhook(
  sql: postgres.Sql,
  deps: BillingDeps,
  webhook: RazorpayWebhook,
): Promise<boolean> {
  const noticeOnly = NOTICE_ONLY[webhook.event];
  const reversing = REVERSING[webhook.event];
  const paymentId = webhook.reversal?.paymentId ?? webhook.payment?.id;
  if ((!noticeOnly && !reversing) || !paymentId) return false;
  const now = deps.now();
  return sql.begin(async (tx) => {
    const [row] = await tx<OrderRow[]>`
      select * from app_billing_orders where razorpay_payment_id = ${paymentId} for update`;
    if (!row) return false;
    const order = toOrder(row);
    const amount = webhook.reversal?.amount ?? null;
    const refundedInFull =
      webhook.event === 'payment.dispute.lost' ||
      webhook.payment?.status === 'refunded' ||
      (webhook.payment?.amountRefunded ?? 0) >= order.tax.totalPaise ||
      (amount ?? 0) >= order.tax.totalPaise;
    const base = { event: webhook.event, amountPaise: amount };
    if (!reversing || !refundedInFull || order.status === 'refunded') {
      if (order.status === 'refunded') return true;
      await recordAudit(tx, {
        accountId: order.accountId,
        action: 'billing.refund_noted',
        target: order.id,
        data: { ...base, paymentId, partial: Boolean(reversing) },
      });
      await queueOperatorNotice(tx, {
        kind: noticeOnly ?? 'refund_started',
        orderId: order.id,
        accountId: order.accountId,
        data: { ...base, partial: Boolean(reversing) },
      });
      return true;
    }
    const delivered = order.status === 'paid';
    const [refunded] = await tx<OrderRow[]>`
      update app_billing_orders
      set status = 'refunded', reversed_at = ${now}, updated_at = ${now}
      where id = ${order.id}
      returning *`;
    const taken = delivered
      ? ((await reversals().get(order.kind)?.(tx, toOrder(refunded!), { now })) ?? {})
      : {};
    await recordAudit(tx, {
      accountId: order.accountId,
      action: 'billing.payment_refunded',
      target: order.id,
      data: { ...base, paymentId, ...taken },
    });
    // A refund of a payment that was never applied is the operator's own doing.
    if (delivered) {
      await queueOperatorNotice(tx, {
        kind: reversing,
        orderId: order.id,
        accountId: order.accountId,
        data: { ...base, ...taken },
      });
    }
    return true;
  });
}

/**
 * Marks orders nobody paid within the payment window as expired. A payment made in time for
 * one of them is still honoured when the news of it arrives late.
 */
export async function expireOrders(sql: Sql, deps: Pick<BillingDeps, 'config' | 'now'>) {
  const now = deps.now();
  const rows = await sql`
    update app_billing_orders set status = 'expired', updated_at = ${now}
    where status = 'created' and created_at < ${new Date(now.getTime() - deps.config.orderWindowMs)}
    returning id`;
  return rows.length;
}

/** Deletes webhook delivery ids older than 30 days; Razorpay retries for one day. */
export async function pruneRazorpayEvents(sql: Sql, now = new Date()): Promise<void> {
  await sql`
    delete from app_razorpay_events where received_at < ${new Date(now.getTime() - 30 * 86_400_000)}`;
}

async function finishInvoiceQuietly(
  sql: postgres.Sql,
  deps: BillingDeps,
  result: FulfilmentResult,
) {
  if (!result.invoice) return;
  await finishInvoice(sql, deps, result.invoice.id).catch((err: unknown) =>
    console.error('[billing] invoice', err instanceof Error ? err.message : err),
  );
}

/** An order of an account, by its own id. */
export async function getOrder(
  sql: Sql,
  accountId: string | null,
  orderId: string,
): Promise<BillingOrder | null> {
  const [row] = await sql<OrderRow[]>`
    select * from app_billing_orders
    where id = ${orderId} and account_id is not distinct from ${accountId}`;
  return row ? toOrder(row) : null;
}

export { toOrder as orderFromRow };
export type { OrderRow };
