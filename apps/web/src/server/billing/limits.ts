import 'server-only';
import { memoryRateLimiter, type RateLimiter } from '@codevibe_technology/sign-server';
import { AppError } from '../errors';

const holder = globalThis as unknown as { __cvsBillingLimiter?: RateLimiter };

/** One in-memory limiter for the billing actions and routes of this process. */
export const billingLimiter = (): RateLimiter =>
  (holder.__cvsBillingLimiter ??= memoryRateLimiter({ maxKeys: 50_000 }));

const TEN_MINUTES = 10 * 60 * 1000;

/** How often one caller may do each thing in ten minutes. */
export const BILLING_LIMITS = {
  /** Orders one person opens in one workspace. */
  orders: 10,
  /** Payment confirmations; Checkout calls once, retries after a dropped connection add a few. */
  confirmations: 30,
  /** Webhook deliveries from one address. */
  webhooks: 600,
} as const;

/** Counts one use of `what` by `who`; throws a `CONFLICT` asking to wait when over the limit. */
export async function enforceBillingLimit(
  what: keyof typeof BILLING_LIMITS,
  who: string,
  now = new Date(),
): Promise<void> {
  const result = await billingLimiter().hit(
    `${what}:${who}`,
    BILLING_LIMITS[what],
    TEN_MINUTES,
    now,
  );
  if (!result.allowed) {
    throw new AppError(
      'CONFLICT',
      'Too many attempts in a short time. Wait a few minutes and try again.',
    );
  }
}
