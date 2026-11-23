'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { installBookingSchema } from '@/lib/billing/install-help';
import { clientAddress } from '../client-address';
import { db } from '../db';
import { AppError } from '../errors';
import {
  createInstallBooking,
  enforceBookingLimit,
  notifyInstallBookings,
} from '../billing/install-help';
import { confirmCheckout, unappliedMessage, type CheckoutSession } from '../billing/orders';
import { billingDeps } from '../billing/runtime';
import { isHosted } from '../plans';
import { requireHuman } from '../human-check';
import { publicAction, type ActionResult } from './action';

function assertHosted() {
  if (!isHosted()) throw new AppError('NOT_FOUND', 'Not found');
}

/**
 * Books installation help: stores the request and opens its order. No account is needed, so
 * the browser's human check token comes along and is checked before anything is stored.
 */
export const bookInstallHelpAction = async (
  raw: unknown,
  humanToken?: string | null,
): Promise<ActionResult<CheckoutSession>> =>
  publicAction(installBookingSchema, async (booking): Promise<CheckoutSession> => {
    assertHosted();
    const requestHeaders = await headers();
    const ip = clientAddress(requestHeaders);
    await enforceBookingLimit(ip);
    await requireHuman(humanToken, requestHeaders);
    const { checkout } = await createInstallBooking(db(), billingDeps(), { booking, ip });
    return checkout;
  })(raw);

/**
 * Confirms the payment of a booking. What the browser sends only points at the payment; it
 * is checked with the payment service before the booking counts as paid.
 */
export const confirmInstallHelpAction = publicAction(
  z.object({
    orderId: z.string().min(1).max(64),
    paymentId: z.string().min(1).max(64),
    signature: z.string().min(1).max(128),
  }),
  async (input): Promise<{ status: 'paid' | 'pending' | 'failed'; invoiceNumber?: string }> => {
    assertHosted();
    await enforceBookingLimit(clientAddress(await headers()));
    const sql = db();
    const deps = billingDeps();
    const outcome = await confirmCheckout(sql, deps, {
      accountId: null,
      razorpayOrderId: input.orderId,
      paymentId: input.paymentId,
      signature: input.signature,
    });
    if (outcome.status === 'unapplied') {
      throw new AppError('CONFLICT', unappliedMessage(outcome.reason, outcome.charged));
    }
    if (outcome.status !== 'paid') return { status: outcome.status };
    if (outcome.kind !== 'install_help') throw new AppError('NOT_FOUND', 'Order not found');
    await notifyInstallBookings(sql, deps);
    return { status: 'paid', invoiceNumber: outcome.invoice.number };
  },
);
