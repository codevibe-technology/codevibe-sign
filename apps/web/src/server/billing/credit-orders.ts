import 'server-only';
import type postgres from 'postgres';
import { formatInr } from '@/lib/billing/money';
import type { Plan } from '@/lib/plans';
import { AppError } from '../errors';
import { recordAudit } from './audit';
import { CREDITS_UNAVAILABLE_MESSAGES, creditsOffer } from './config';
import { grantCredits } from './credits';
import { getBillingDetails } from './details';
import {
  createOrder,
  type BillingDeps,
  type BillingOrder,
  type CheckoutSession,
  type Fulfilment,
} from './orders';

/** The form field a missing billing address points at. */
export const BILLING_DETAILS_FIELD = 'billingDetails';

/** `Aadhaar eSign credits × 50 @ ₹35`: the one line of a credits invoice. */
export const creditsLine = (credits: number, pricePaise: number) =>
  `Aadhaar eSign credits × ${credits} @ ${formatInr(pricePaise)}`;

/**
 * Opens an order for one pack of eSign credits at the workspace's current price. The pack must
 * be one the operator offers, and the workspace needs billing details for the invoice.
 */
export async function createCreditsOrder(
  sql: postgres.Sql,
  deps: BillingDeps,
  input: { workspaceId: string; userId: string; plan: Plan; credits: number; ip?: string | null },
): Promise<{ order: BillingOrder; checkout: CheckoutSession }> {
  const offer = creditsOffer(deps.config, input.plan);
  if (offer.unavailable || offer.pricePaise === null) {
    throw new AppError(
      'CONFLICT',
      CREDITS_UNAVAILABLE_MESSAGES[offer.unavailable ?? 'price_not_set'],
    );
  }
  if (!offer.packs.includes(input.credits)) {
    throw new AppError('VALIDATION', 'Pick one of the credit packs on offer', 'credits');
  }
  const buyer = await getBillingDetails(sql, input.workspaceId);
  if (!buyer) {
    throw new AppError(
      'VALIDATION',
      'Add your billing details first. They are printed on the tax invoice.',
      BILLING_DETAILS_FIELD,
    );
  }
  return createOrder(sql, deps, {
    workspaceId: input.workspaceId,
    kind: 'esign_credits',
    lines: [
      {
        description: creditsLine(input.credits, offer.pricePaise),
        quantity: input.credits,
        unitPaise: offer.pricePaise,
      },
    ],
    payload: { credits: input.credits },
    buyer,
    createdBy: input.userId,
    summary: `${input.credits} Aadhaar eSign credits`,
    ip: input.ip ?? null,
  });
}

/** Paying for a credits order adds its credits to the workspace, once. */
export const fulfilCredits: Fulfilment = async (tx, order) => {
  const credits = order.payload.credits;
  if (!order.workspaceId || typeof credits !== 'number') {
    throw new Error(`Credits order ${order.id} has no workspace or no credit count`);
  }
  const granted = await grantCredits(tx, {
    workspaceId: order.workspaceId,
    credits,
    ref: order.id,
    reason: 'purchase',
  });
  if (granted) {
    await recordAudit(tx, {
      workspaceId: order.workspaceId,
      actorId: order.createdBy,
      action: 'credits.granted',
      target: order.id,
      data: { credits },
    });
  }
};
