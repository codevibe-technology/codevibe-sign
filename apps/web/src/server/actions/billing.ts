'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { billingDetailsShape, checkGstin, type BillingDetails } from '@/lib/billing/details';
import { clientAddress } from '../client-address';
import { db } from '../db';
import { createCreditsOrder } from '../billing/credit-orders';
import {
  creditBalance,
  creditHistory,
  type CreditBalance,
  type CreditEntry,
} from '../billing/credits';
import { saveBillingDetails } from '../billing/details';
import { listInvoices } from '../billing/invoices';
import { enforceBillingLimit } from '../billing/limits';
import {
  confirmCheckout,
  unappliedMessage,
  type CheckoutSession,
  type OrderKind,
} from '../billing/orders';
import { AppError } from '../errors';
import { summarizeInvoice, type InvoiceSummary } from '../billing/overview';
import { billingDeps } from '../billing/runtime';
import { workspacePlan } from '../plans';
import { workspaceAction } from './action';

const refresh = (slug: string) => revalidatePath(`/dashboard/${slug}/settings`, 'layout');

export const saveBillingDetailsAction = workspaceAction(
  'billing.manage',
  z.object(billingDetailsShape).superRefine(checkGstin),
  async (ctx, details): Promise<BillingDetails> => {
    await saveBillingDetails(db(), { workspaceId: ctx.workspace.id, userId: ctx.user.id, details });
    refresh(ctx.workspace.slug);
    return details;
  },
);

/** Opens an order for a pack of eSign credits and returns what Razorpay Checkout needs. */
export const createCreditsOrderAction = workspaceAction(
  'billing.manage',
  z.object({ credits: z.coerce.number().int().min(1).max(100_000) }),
  async (ctx, input): Promise<CheckoutSession> => {
    await enforceBillingLimit('orders', `${ctx.workspace.id}:${ctx.user.id}`);
    const sql = db();
    const { plan } = await workspacePlan(sql, ctx.workspace.id);
    const { checkout } = await createCreditsOrder(sql, billingDeps(), {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      plan,
      credits: input.credits,
      ip: clientAddress(await headers()),
    });
    return checkout;
  },
);

export interface PaymentConfirmation {
  status: 'paid' | 'pending' | 'failed';
  kind?: OrderKind;
  invoiceId?: string;
  invoiceNumber?: string;
  credits?: CreditBalance;
}

/**
 * Confirms a payment after Razorpay Checkout closes, for any kind of order of the workspace.
 * What the browser sends is only a pointer: the payment is checked with the payment service.
 */
export const confirmPaymentAction = workspaceAction(
  'billing.manage',
  z.object({
    orderId: z.string().min(1).max(64),
    paymentId: z.string().min(1).max(64),
    signature: z.string().min(1).max(128),
  }),
  async (ctx, input): Promise<PaymentConfirmation> => {
    await enforceBillingLimit('confirmations', `${ctx.workspace.id}:${ctx.user.id}`);
    const sql = db();
    const outcome = await confirmCheckout(sql, billingDeps(), {
      workspaceId: ctx.workspace.id,
      razorpayOrderId: input.orderId,
      paymentId: input.paymentId,
      signature: input.signature,
    });
    if (outcome.status === 'unapplied') {
      throw new AppError('CONFLICT', unappliedMessage(outcome.reason, outcome.charged));
    }
    if (outcome.status !== 'paid') return { status: outcome.status };
    refresh(ctx.workspace.slug);
    return {
      status: 'paid',
      kind: outcome.kind,
      invoiceId: outcome.invoice.id,
      invoiceNumber: outcome.invoice.number,
      credits: await creditBalance(sql, ctx.workspace.id),
    };
  },
);

export const listInvoicesAction = workspaceAction(
  'billing.manage',
  z.object({}),
  async (ctx): Promise<InvoiceSummary[]> =>
    (await listInvoices(db(), ctx.workspace.id)).map(summarizeInvoice),
);

export const creditHistoryAction = workspaceAction(
  'billing.manage',
  z.object({}),
  async (ctx): Promise<{ balance: CreditBalance; entries: CreditEntry[] }> => {
    const sql = db();
    const [balance, entries] = await Promise.all([
      creditBalance(sql, ctx.workspace.id),
      creditHistory(sql, ctx.workspace.id),
    ]);
    return { balance, entries };
  },
);
