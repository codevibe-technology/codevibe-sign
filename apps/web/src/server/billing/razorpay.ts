import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Paise } from '@/lib/billing/money';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RazorpayOrder {
  id: string;
  amount: Paise;
  currency: string;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  amount: Paise;
  currency: string;
  /** `created`, `authorized`, `captured`, `refunded` or `failed`. */
  status: string;
  /** How it was paid: `upi`, `card`, `netbanking`, `wallet` and so on, when the service says. */
  method?: string | undefined;
}

export interface RazorpayClient {
  createOrder(input: {
    amountPaise: Paise;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOrder>;
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
  capturePayment(paymentId: string, amountPaise: Paise): Promise<RazorpayPayment>;
}

/** The payment service failed or refused. The message never holds a key or a response body. */
export class RazorpayError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'RazorpayError';
    this.status = status;
    this.retryable = retryable;
  }
}

const ID_PATTERN = /^[A-Za-z0-9_]{6,64}$/;
/** Ids come from the browser and from webhooks; only this shape ever reaches a URL or a query. */
export const isRazorpayId = (value: unknown): value is string =>
  typeof value === 'string' && ID_PATTERN.test(value);

const MAX_RESPONSE_BYTES = 256 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function paymentOf(value: unknown): RazorpayPayment | null {
  const body = record(value);
  if (!body || !isRazorpayId(body.id) || !Number.isSafeInteger(body.amount)) return null;
  return {
    id: body.id,
    orderId: isRazorpayId(body.order_id) ? body.order_id : null,
    amount: body.amount as number,
    currency: typeof body.currency === 'string' ? body.currency : '',
    status: typeof body.status === 'string' ? body.status : '',
    method:
      typeof body.method === 'string' && /^[a-z_]{2,24}$/.test(body.method)
        ? body.method
        : undefined,
  };
}

export function createRazorpay(options: {
  keyId: string;
  keySecret: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
}): RazorpayClient {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const baseUrl = (options.baseUrl ?? 'https://api.razorpay.com/v1').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;
  const authorization = `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            authorization,
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch {
        throw new RazorpayError(
          controller.signal.aborted
            ? 'The payment service did not answer in time'
            : 'The payment service could not be reached',
          null,
          true,
        );
      }
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        throw new RazorpayError(
          `The payment service answered ${response.status}`,
          response.status,
          response.status >= 500 || response.status === 429,
        );
      }
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new RazorpayError(
          'The payment service sent too large an answer',
          response.status,
          false,
        );
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new RazorpayError(
          'The payment service sent an answer that is not JSON',
          response.status,
          false,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const unexpected = () =>
    new RazorpayError('The payment service sent an unexpected answer', null, false);

  return {
    async createOrder(input) {
      const body = record(
        await call('POST', '/orders', {
          amount: input.amountPaise,
          currency: 'INR',
          receipt: input.receipt,
          notes: input.notes ?? {},
        }),
      );
      if (!body || !isRazorpayId(body.id) || body.amount !== input.amountPaise) throw unexpected();
      return {
        id: body.id,
        amount: input.amountPaise,
        currency: typeof body.currency === 'string' ? body.currency : '',
        status: typeof body.status === 'string' ? body.status : '',
      };
    },
    async fetchPayment(paymentId) {
      if (!isRazorpayId(paymentId)) throw unexpected();
      const payment = paymentOf(await call('GET', `/payments/${paymentId}`));
      if (!payment) throw unexpected();
      return payment;
    },
    async capturePayment(paymentId, amountPaise) {
      if (!isRazorpayId(paymentId)) throw unexpected();
      const payment = paymentOf(
        await call('POST', `/payments/${paymentId}/capture`, {
          amount: amountPaise,
          currency: 'INR',
        }),
      );
      if (!payment) throw unexpected();
      return payment;
    },
  };
}

function hmacMatches(secret: string, payload: string | Uint8Array, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** Checks what Razorpay Checkout hands the browser: HMAC-SHA256 of `order_id|payment_id`. */
export function verifyCheckoutSignature(
  input: { orderId: string; paymentId: string; signature: string },
  keySecret: string,
): boolean {
  return hmacMatches(keySecret, `${input.orderId}|${input.paymentId}`, input.signature);
}

/** Checks `X-Razorpay-Signature`: HMAC-SHA256 of the raw webhook body. */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signature: string,
  webhookSecret: string,
): boolean {
  return hmacMatches(webhookSecret, rawBody, signature);
}

export interface RazorpayWebhook {
  /** For example `payment.captured`. */
  event: string;
  payment: RazorpayPayment | null;
  orderId: string | null;
}

/** Reads a webhook body that has already passed `verifyWebhookSignature`. Null when it is not one. */
export function parseWebhook(rawBody: string): RazorpayWebhook | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const body = record(json);
  if (!body || typeof body.event !== 'string') return null;
  const payload = record(body.payload);
  const payment = paymentOf(record(record(payload?.payment)?.entity));
  const order = record(record(payload?.order)?.entity);
  return {
    event: body.event,
    payment,
    orderId: payment?.orderId ?? (isRazorpayId(order?.id) ? order.id : null),
  };
}
