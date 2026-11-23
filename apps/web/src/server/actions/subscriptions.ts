'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TERMS } from '@/lib/billing/terms';
import { clientAddress } from '../client-address';
import { db } from '../db';
import { AppError } from '../errors';
import { enforceBillingLimit } from '../billing/limits';
import type { CheckoutSession } from '../billing/orders';
import { billingDeps } from '../billing/runtime';
import {
  MAX_EXTRA_SEATS,
  createSeatsOrder,
  createSubscriptionOrder,
  scheduleCancel,
  setRenewalSeats,
} from '../billing/subscriptions';
import { isHosted } from '../plans';
import { workspaceAction } from './action';

const refresh = (slug: string) => revalidatePath(`/dashboard/${slug}/settings`, 'layout');

/** Plans are sold on the hosted cloud only; a self-hosted install has nothing to buy. */
function assertHosted() {
  if (!isHosted()) throw new AppError('NOT_FOUND', 'Not found');
}

const seats = z.coerce.number().int().min(0).max(MAX_EXTRA_SEATS);

/** Opens the order for a first Cloud term or the next one. Confirm with `confirmPaymentAction`. */
export const startSubscriptionAction = workspaceAction(
  'billing.manage',
  z.object({ term: z.enum(TERMS), seats: seats.optional() }),
  async (ctx, input): Promise<CheckoutSession> => {
    assertHosted();
    await enforceBillingLimit('orders', `${ctx.workspace.id}:${ctx.user.id}`);
    const { checkout } = await createSubscriptionOrder(db(), billingDeps(), {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      term: input.term,
      seats: input.seats,
      ip: clientAddress(await headers()),
    });
    return checkout;
  },
);

/** Opens the order for more members in the current term, charged for the days left. */
export const addSeatsAction = workspaceAction(
  'billing.manage',
  z.object({ add: z.coerce.number().int().min(1).max(MAX_EXTRA_SEATS) }),
  async (ctx, input): Promise<CheckoutSession> => {
    assertHosted();
    await enforceBillingLimit('orders', `${ctx.workspace.id}:${ctx.user.id}`);
    const { checkout } = await createSeatsOrder(db(), billingDeps(), {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      add: input.add,
      ip: clientAddress(await headers()),
    });
    return checkout;
  },
);

/** Stops, or keeps, the subscription at the end of the paid term. */
export const scheduleCancelAction = workspaceAction(
  'billing.manage',
  z.object({ cancel: z.union([z.boolean(), z.enum(['true', 'false'])]) }),
  async (ctx, input): Promise<{ cancelAtPeriodEnd: boolean }> => {
    assertHosted();
    const subscription = await scheduleCancel(db(), {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      cancel: input.cancel === true || input.cancel === 'true',
    });
    refresh(ctx.workspace.slug);
    return { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd };
  },
);

/** Sets how many extra members the next term is charged for. */
export const setRenewalSeatsAction = workspaceAction(
  'billing.manage',
  z.object({ seats }),
  async (ctx, input): Promise<{ renewalSeats: number }> => {
    assertHosted();
    const subscription = await setRenewalSeats(db(), {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      seats: input.seats,
      config: billingDeps().config,
    });
    refresh(ctx.workspace.slug);
    return { renewalSeats: subscription.renewalSeats };
  },
);
