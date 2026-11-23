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
import {
  RazorpayError,
  isRazorpayId,
  parseWebhook,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type RazorpayClient,
  type RazorpayPayment,
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
export type OrderStatus = 'created' | 'paid' | 'failed' | 'expired';
export type OrderPayload = Record<string, string | number | boolean | null>;

export interface BillingOrder {
  id: string;
  /** Null for a purchase made without a workspace. */
  workspaceId: string | null;
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
 * per order; throwing leaves the order unpaid so the payment is tried again.
 */
export type Fulfilment = (tx: Tx, order: BillingOrder, context: { now: Date }) => Promise<void>;

const holder = globalThis as unknown as { __cvsFulfilments?: Map<OrderKind, Fulfilment> };
const fulfilments = () => (holder.__cvsFulfilments ??= new Map());

/** Says what paying for an order of `kind` delivers. One handler per kind; the last one wins. */
export function registerFulfilment(kind: OrderKind, handler: Fulfilment): void {
  fulfilments().set(kind, handler);
}

interface OrderRow {
  id: string;
  workspace_id: string | null;
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
    workspaceId: row.workspace_id,
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
  workspaceId: string | null;
  kind: OrderKind;
  /** What the invoice lists. Amounts come from the server's own prices, never from a request. */
  lines: { description: string; quantity: number; unitPaise: Paise }[];
  payload: OrderPayload;
  buyer: BillingDetails;
  createdBy: string | null;
  /** One line for the payment window, for example "50 Aadhaar eSign credits". */
  summary: string;
  ip?: string | null;
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
      notes: { kind: input.kind, ...(input.workspaceId ? { workspace: input.workspaceId } : {}) },
    })
    .catch(providerFailure);

  const [row] = await sql.begin(async (tx) => {
    const rows = await tx<OrderRow[]>`
      insert into app_billing_orders (
        id, workspace_id, kind, payload, lines, buyer, seller, sac, gst_percent, taxable_paise,
        cgst_paise, sgst_paise, igst_paise, total_paise, mode, razorpay_order_id, created_by
      ) values (
        ${id}, ${input.workspaceId}, ${input.kind}, ${tx.json(input.payload)},
        ${tx.json(lines as never)}, ${tx.json(input.buyer as never)}, ${tx.json(seller as never)},
        ${deps.config.sac}, ${deps.config.gstPercent}, ${tax.taxablePaise}, ${tax.cgstPaise},
        ${tax.sgstPaise}, ${tax.igstPaise}, ${tax.totalPaise}, ${keys.mode}, ${remote.id},
        ${input.createdBy}
      )
      returning *`;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
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
  invoice: IssuedInvoice;
  /** False when the order had been fulfilled before this call. */
  fresh: boolean;
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

async function nextInvoiceNumber(tx: Tx, config: BillingConfig, order: BillingOrder, now: Date) {
  // Test payments get their own series, so the tax series has no gaps and no test documents.
  const prefix =
    order.mode === 'test' ? seriesPrefix('T-{FYS}-', now) : seriesPrefix(config.series, now);
  const [row] = await tx<{ last_sequence: number }[]>`
    insert into app_invoice_counters (prefix, last_sequence) values (${prefix}, 1)
    on conflict (prefix) do update set last_sequence = app_invoice_counters.last_sequence + 1
    returning last_sequence`;
  return invoiceNumber(prefix, row!.last_sequence);
}

/**
 * Marks an order paid, delivers what it bought and issues its invoice, all in one transaction
 * with the order row locked. Safe to call any number of times, from the browser confirmation
 * and from webhooks at once: only the first call does anything.
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
    if (order.status === 'paid') {
      const [invoice] = await tx<IssuedInvoice[]>`
        select id, number from app_invoices where order_id = ${order.id}`;
      return { order, invoice: invoice!, fresh: false };
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
    await handler(tx, paidOrder, { now });
    const number = await nextInvoiceNumber(tx, deps.config, paidOrder, now);
    const invoice = { id: randomId('inv'), number };
    await tx`
      insert into app_invoices (id, number, order_id, workspace_id, issued_at)
      values (${invoice.id}, ${number}, ${order.id}, ${order.workspaceId}, ${now})`;
    await recordAudit(tx, {
      workspaceId: order.workspaceId,
      action: 'billing.payment_captured',
      target: order.id,
      data: { paymentId: payment.id, totalPaise: order.tax.totalPaise, mode: order.mode },
    });
    await recordAudit(tx, {
      workspaceId: order.workspaceId,
      action: 'billing.invoice_issued',
      target: invoice.id,
      data: { number, orderId: order.id, totalPaise: order.tax.totalPaise },
    });
    return { order: paidOrder, invoice, fresh: true };
  });
}

export type CheckoutOutcome =
  | { status: 'paid'; orderId: string; kind: OrderKind; invoice: IssuedInvoice }
  /** The payment exists but is not captured yet; the webhook finishes it. */
  | { status: 'pending' }
  | { status: 'failed' };

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
    workspaceId: string | null;
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
      and workspace_id is not distinct from ${input.workspaceId}`;
  if (!row) throw new AppError('NOT_FOUND', 'Order not found');
  if (!verifyCheckoutSignature({ ...input, orderId: row.razorpay_order_id }, keys.keySecret)) {
    throw new AppError('VALIDATION', UNVERIFIED);
  }
  let payment = await razorpay.fetchPayment(input.paymentId).catch(providerFailure);
  if (payment.orderId !== row.razorpay_order_id) throw new PaymentMismatchError();
  if (payment.status === 'authorized') {
    if (payment.amount !== Number(row.total_paise)) throw new PaymentMismatchError();
    payment = await razorpay
      .capturePayment(payment.id, payment.amount)
      // Another request or the account's auto-capture may have captured it first.
      .catch(() => razorpay.fetchPayment(input.paymentId).catch(providerFailure));
  }
  if (payment.status === 'failed') return { status: 'failed' };
  if (payment.status !== 'captured') return { status: 'pending' };
  const result = await fulfilOrder(sql, deps, row.razorpay_order_id, payment);
  if (result.fresh) await afterFulfil(result);
  return {
    status: 'paid',
    orderId: result.order.id,
    kind: result.order.kind,
    invoice: result.invoice,
  };
}

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
        if (result.fresh) await afterFulfil(result);
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
  if (eventId) {
    await sql`
      insert into app_razorpay_events (event_id, event) values (${eventId}, ${webhook.event})
      on conflict (event_id) do nothing`;
  }
  return outcome;
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
  await finishInvoice(sql, deps, result.invoice.id).catch((err: unknown) =>
    console.error('[billing] invoice', err instanceof Error ? err.message : err),
  );
}

/** An order of a workspace, by its own id. */
export async function getOrder(
  sql: Sql,
  workspaceId: string | null,
  orderId: string,
): Promise<BillingOrder | null> {
  const [row] = await sql<OrderRow[]>`
    select * from app_billing_orders
    where id = ${orderId} and workspace_id is not distinct from ${workspaceId}`;
  return row ? toOrder(row) : null;
}

export { toOrder as orderFromRow };
export type { OrderRow };
