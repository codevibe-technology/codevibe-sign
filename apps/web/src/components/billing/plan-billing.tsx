'use client';

import { CalendarClock, Minus, Plus, TriangleAlert, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogRoot } from '@/components/ui/dialog';
import { formatInr } from '@/lib/billing/money';
import type { Term } from '@/lib/billing/terms';
import { cn } from '@/lib/cn';
import type { ActionResult } from '@/server/actions/action';
import { confirmPaymentAction } from '@/server/actions/billing';
import {
  addSeatsAction,
  scheduleCancelAction,
  setRenewalSeatsAction,
  startSubscriptionAction,
} from '@/server/actions/subscriptions';
import type { CheckoutSession } from '@/server/billing/orders';
import type { PlanPrices, SubscriptionView } from '@/server/billing/subscriptions';
import { openCheckout } from './razorpay-checkout';

export interface PlanBillingProps {
  workspaceId: string;
  slug: string;
  subscription: SubscriptionView;
  prices: PlanPrices;
  /** Payments can be taken on this install. */
  paymentsOpen: boolean;
  testMode: boolean;
  hasBillingDetails: boolean;
  /** Admins and owners pay; everyone else reads. */
  /** The signed-in person owns the account this workspace is on. */
  canManage: boolean;
  /** The account owner's name, for everyone else. */
  managedBy?: string | null;
}

const MAX_SEATS = 500;

function Stepper({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  const set = (next: number) => onChange(Math.max(min, Math.min(MAX_SEATS, next)));
  return (
    <div className="inline-flex items-center rounded-md border border-line-strong bg-surface">
      <button
        type="button"
        aria-label={`Fewer: ${label}`}
        className="flex h-10 w-10 items-center justify-center text-ink hover:bg-surface-2 disabled:opacity-40"
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        <Minus aria-hidden className="h-4 w-4" />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        className="h-10 w-14 border-x border-line bg-transparent text-center text-[15px] font-semibold focus:outline-none focus:ring-3 focus:ring-primary/20"
        value={value}
        onChange={(event) => set(Number(event.target.value.replace(/\D/g, '')) || 0)}
      />
      <button
        type="button"
        aria-label={`More: ${label}`}
        className="flex h-10 w-10 items-center justify-center text-ink hover:bg-surface-2 disabled:opacity-40"
        disabled={value >= MAX_SEATS}
        onClick={() => set(value + 1)}
      >
        <Plus aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Paying for the Cloud plan from the Plan and usage page: the first term, the next one, more
 * members in the middle of a term, and stopping at the end of a term. Every amount shown is
 * worked out again on the server before the payment window opens.
 */
export function PlanBilling({
  workspaceId,
  slug,
  subscription,
  prices,
  paymentsOpen,
  testMode,
  hasBillingDetails,
  canManage,
  managedBy = null,
}: PlanBillingProps) {
  const router = useRouter();
  const [term, setTerm] = useState<Term>(subscription.term ?? 'month');
  const [seats, setSeats] = useState(subscription.renewalSeats);
  const [add, setAdd] = useState(1);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'seats' | 'cancel' | null>(null);
  const billingHref = `/dashboard/${slug}/settings/billing`;

  async function pay(order: () => Promise<ActionResult<CheckoutSession>>, done: string) {
    setBusy(true);
    try {
      const opened = await order();
      if (!opened.ok) {
        toast.error(opened.error);
        return;
      }
      const payment = await openCheckout(opened.data);
      if (!payment) return;
      const confirmed = await confirmPaymentAction({ workspaceId, ...payment });
      if (!confirmed.ok) toast.error(confirmed.error);
      else if (confirmed.data.status === 'paid') {
        toast.success(done);
        setDialog(null);
        router.refresh();
      } else if (confirmed.data.status === 'pending') {
        toast.message('The payment is being confirmed. This page updates when it is done.');
      } else toast.error('The payment did not go through. Nothing was charged.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The payment window could not open.');
    } finally {
      setBusy(false);
    }
  }

  async function change(call: () => Promise<ActionResult<unknown>>, done: string) {
    setBusy(true);
    const result = await call();
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(done);
    setDialog(null);
    router.refresh();
  }

  const { state } = subscription;
  if (state === 'managed') {
    return (
      <p className="px-5 py-4 text-sm text-muted" data-testid="plan-billing">
        This plan was set up by our team. Write to us to change it.
      </p>
    );
  }

  const termPaise = (t: Term) => (t === 'year' ? prices.yearPaise : prices.monthPaise);
  const seatPaise = (t: Term) => (t === 'year' ? prices.seatYearPaise : prices.seatMonthPaise);
  const total = termPaise(term) + seats * seatPaise(term);
  const buying = state === 'none' || state === 'ended';
  const renewing = (state === 'active' && subscription.canRenew) || state === 'grace';

  const blocker = !paymentsOpen ? (
    <p className="text-sm text-muted" data-testid="payments-closed">
      <Badge tone="accent">Coming soon</Badge>{' '}
      <span className="ml-1">Paying for Cloud opens shortly. Nothing here can be charged yet.</span>
    </p>
  ) : !canManage ? (
    <p className="text-sm text-muted" data-testid="plan-managed-by">
      {managedBy
        ? `This workspace is on ${managedBy}'s account. Only they can change the plan or pay for it.`
        : 'Only the owner of the account this workspace is on can change the plan or pay for it.'}
    </p>
  ) : !hasBillingDetails ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        Add billing details first. They are printed on your tax invoice.
      </p>
      <Button asChild variant="secondary">
        <Link href={billingHref}>Add billing details</Link>
      </Button>
    </div>
  ) : null;

  const chooser = (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-ink">Pay for</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['month', 'year'] as const).map((option) => (
            <label
              key={option}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
                term === option
                  ? 'border-primary bg-primary-soft'
                  : 'border-line-strong hover:border-muted/60',
              )}
            >
              <input
                type="radio"
                name="term"
                className="mt-1 accent-primary"
                checked={term === option}
                onChange={() => setTerm(option)}
              />
              <span>
                <span className="block text-sm font-semibold">
                  {option === 'month' ? 'One month' : 'One year'}
                  {option === 'year' && prices.annualMonths < 12 ? (
                    <span className="ml-2">
                      <Badge tone="success">{12 - prices.annualMonths} months free</Badge>
                    </span>
                  ) : null}
                </span>
                <span className="block text-sm text-muted">
                  {formatInr(termPaise(option))} {option === 'month' ? 'a month' : 'a year'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-ink">Extra members</p>
          <p className="text-[13px] text-muted">
            {prices.includedMembers} are included. More are {formatInr(prices.seatMonthPaise)} each
            a month.
          </p>
        </div>
        <Stepper label="Extra members" value={seats} onChange={setSeats} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-muted">
          <span className="font-display text-2xl font-bold text-ink" data-testid="plan-total">
            {formatInr(total)}
          </span>{' '}
          plus {prices.gstPercent}% GST
        </p>
        <Button
          pending={busy}
          onClick={() =>
            pay(
              () => startSubscriptionAction({ workspaceId, term, seats }),
              buying ? 'This workspace is now on Cloud.' : 'The next term is paid.',
            )
          }
        >
          {buying ? 'Upgrade to Cloud' : 'Pay for the next term'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 px-5 py-4" data-testid="plan-billing">
      {testMode && paymentsOpen ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <Badge tone="warning">Test mode</Badge>
          Payments use test keys. No money moves.
        </p>
      ) : null}

      {state === 'grace' ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3"
        >
          <TriangleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <p className="text-sm text-ink">
            <span className="font-semibold">The Cloud term ended on {subscription.periodEnd}.</span>{' '}
            Everything keeps working until {subscription.graceEndsAt}. After that this workspace
            moves to the Free plan. Nothing is deleted.
          </p>
        </div>
      ) : null}

      {state === 'active' ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-start gap-2 text-sm text-ink">
            <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <span>
              {subscription.cancelAtPeriodEnd ? (
                <>
                  Cloud until <span className="font-semibold">{subscription.periodEnd}</span>, then
                  the Free plan. It will not be renewed.
                </>
              ) : (
                <>
                  Paid up to <span className="font-semibold">{subscription.periodEnd}</span>
                  {subscription.renewFrom
                    ? `. The next term can be paid from ${subscription.renewFrom}.`
                    : '. The next term can be paid now.'}
                </>
              )}
              {subscription.seats > 0 ? (
                <span className="block text-[13px] text-muted">
                  {subscription.seats} extra {subscription.seats === 1 ? 'member' : 'members'} in
                  this term
                  {subscription.renewalSeats !== subscription.seats
                    ? `, ${subscription.renewalSeats} from the next`
                    : ''}
                  .
                </span>
              ) : null}
            </span>
          </p>
          {canManage && paymentsOpen ? (
            <div className="flex flex-wrap gap-2">
              {!subscription.cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasBillingDetails}
                  onClick={() => setDialog('seats')}
                >
                  <UserPlus aria-hidden className="h-4 w-4" />
                  Add members
                </Button>
              ) : null}
              {subscription.cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  size="sm"
                  pending={busy}
                  onClick={() =>
                    change(
                      () => scheduleCancelAction({ workspaceId, cancel: false }),
                      'Cloud stays on. You will be reminded before the term ends.',
                    )
                  }
                >
                  Keep Cloud
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setDialog('cancel')}>
                  Cancel plan
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {blocker ??
        (buying || renewing ? (
          chooser
        ) : state === 'active' && !subscription.cancelAtPeriodEnd ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-muted">Extra members from the next term</p>
            <div className="flex items-center gap-2">
              <Stepper label="Extra members from the next term" value={seats} onChange={setSeats} />
              {subscription.renewalSeats !== seats ? (
                <Button
                  variant="secondary"
                  pending={busy}
                  onClick={() =>
                    change(
                      () => setRenewalSeatsAction({ workspaceId, seats }),
                      'Saved for the next term.',
                    )
                  }
                >
                  Save
                </Button>
              ) : null}
            </div>
          </div>
        ) : null)}

      <DialogRoot
        open={dialog === 'seats'}
        onOpenChange={(open) => setDialog(open ? 'seats' : null)}
      >
        <DialogContent
          title="Add members"
          description={`You pay for the days left in this term, up to ${subscription.periodEnd}. The next term includes them at ${formatInr(seatPaise(subscription.term ?? 'month'))} each.`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">Members to add</p>
            <Stepper label="Members to add" value={add} onChange={setAdd} min={1} />
          </div>
          <p className="mt-3 text-[13px] text-muted">
            The exact amount, with {prices.gstPercent}% GST, is shown in the payment window before
            you pay. They can be invited as soon as the payment is confirmed.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="ghost">Not now</Button>
            </DialogClose>
            <Button
              pending={busy}
              onClick={() =>
                pay(
                  () => addSeatsAction({ workspaceId, add }),
                  `${add} ${add === 1 ? 'member' : 'members'} added to your plan.`,
                )
              }
            >
              Continue to payment
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>

      <DialogRoot
        open={dialog === 'cancel'}
        onOpenChange={(open) => setDialog(open ? 'cancel' : null)}
      >
        <DialogContent
          title="Cancel the Cloud plan?"
          description={`Cloud stays on until ${subscription.periodEnd}. After that the workspace moves to the Free plan.`}
        >
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
            <li>Nothing is deleted: documents, templates and members all stay.</li>
            <li>The Free limits apply to anything new, and webhooks are paused.</li>
            <li>The term already paid for is not refunded.</li>
            <li>You can change your mind any time before {subscription.periodEnd}.</li>
          </ul>
          <div className="mt-6 flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="ghost">Keep Cloud</Button>
            </DialogClose>
            <Button
              variant="danger"
              pending={busy}
              onClick={() =>
                change(
                  () => scheduleCancelAction({ workspaceId, cancel: true }),
                  `Cloud ends on ${subscription.periodEnd}.`,
                )
              }
            >
              Cancel at the end of the term
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
