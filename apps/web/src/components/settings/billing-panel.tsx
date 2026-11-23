'use client';

import { CircleCheck, Clock, Download, FileText, Pencil, ReceiptText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { openCheckout } from '@/components/billing/razorpay-checkout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DialogClose, DialogRoot, SheetContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { LocalTime } from '@/components/ui/local-time';
import type { BillingDetails } from '@/lib/billing/details';
import { INDIAN_STATES, computeTax, stateByCode } from '@/lib/billing/gst';
import { formatInr } from '@/lib/billing/money';
import { cn } from '@/lib/cn';
import {
  confirmPaymentAction,
  createCreditsOrderAction,
  saveBillingDetailsAction,
} from '@/server/actions/billing';
import type { CreditEntry } from '@/server/billing/credits';
import type { BillingOverview } from '@/server/billing/overview';
import { useAction } from './use-action';

const UNAVAILABLE: Record<string, string> = {
  payments_not_configured: 'Payments are not available yet. Buying credits is coming soon.',
  esign_not_configured: 'Aadhaar eSign is not switched on yet. Credits will be sold here soon.',
  price_not_set: 'The price of an Aadhaar eSign has not been published yet. It is coming soon.',
  test_payments: 'Buying credits is switched off for now. It will be back soon.',
};

const ENTRY_LABELS: Record<CreditEntry['kind'], string> = {
  grant: 'Bought',
  reserve: 'Held for an eSign',
  consume: 'Used',
  release: 'Returned',
};

const ENTRY_SIGN: Record<CreditEntry['kind'], string> = {
  grant: '+',
  reserve: '−',
  consume: '',
  release: '+',
};

type Purchase =
  | { state: 'idle' }
  | { state: 'paid'; credits: number; invoiceId?: string; invoiceNumber?: string }
  | { state: 'pending' }
  | { state: 'failed'; message: string };

function Address({ details }: { details: BillingDetails }) {
  const state = stateByCode(details.stateCode);
  return (
    <address className="text-sm leading-6 text-ink not-italic" data-testid="billing-details">
      <span className="block font-semibold">{details.legalName}</span>
      <span className="block">
        {[details.addressLine1, details.addressLine2].filter(Boolean).join(', ')}
      </span>
      <span className="block">
        {details.city} {details.pin}, {state?.name ?? details.stateCode}
      </span>
      <span className="block text-muted">
        {details.gstin ? `GSTIN ${details.gstin}` : 'No GSTIN (unregistered)'} · {details.email}
      </span>
    </address>
  );
}

/**
 * Settings, Billing: who invoices are made out to, the prepaid Aadhaar eSign credits and how
 * to buy more, what happened to each credit, and every invoice as a PDF.
 */
export function BillingPanel({
  workspaceId,
  sellerStateCode,
  overview,
  history,
}: {
  workspaceId: string;
  /** Decides whether a purchase shows CGST and SGST, or IGST. Null while not configured. */
  sellerStateCode: string | null;
  overview: BillingOverview;
  history: CreditEntry[];
}) {
  const router = useRouter();
  const { offer, credits } = overview;
  const [details, setDetails] = useState(overview.details);
  const [sheet, setSheet] = useState(false);
  const [pack, setPack] = useState(offer.packs[0] ?? 0);
  const [purchase, setPurchase] = useState<Purchase>({ state: 'idle' });
  const [balance, setBalance] = useState(credits);
  const [buying, startBuying] = useTransition();
  const save = useAction();

  const canBuy = offer.unavailable === null && offer.pricePaise !== null;
  const tax =
    offer.pricePaise !== null && pack > 0
      ? computeTax({
          taxablePaise: offer.pricePaise * pack,
          gstPercent: offer.gstPercent,
          sellerStateCode: sellerStateCode ?? '',
          buyerStateCode: details?.stateCode ?? '',
        })
      : null;

  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('workspaceId', workspaceId);
    save.run(() => saveBillingDetailsAction(form), {
      success: 'Billing details saved',
      onSuccess: (saved) => {
        setDetails(saved);
        setSheet(false);
      },
    });
  }

  function buy() {
    if (!details) {
      setSheet(true);
      return;
    }
    startBuying(async () => {
      setPurchase({ state: 'idle' });
      const order = await createCreditsOrderAction({ workspaceId, credits: pack });
      if (!order.ok) {
        if (order.field === 'billingDetails') setSheet(true);
        setPurchase({ state: 'failed', message: order.error });
        return;
      }
      let payment;
      try {
        payment = await openCheckout(order.data);
      } catch (error) {
        setPurchase({
          state: 'failed',
          message: error instanceof Error ? error.message : 'The payment window did not open.',
        });
        return;
      }
      if (!payment) return;
      const confirmed = await confirmPaymentAction({ workspaceId, ...payment });
      if (!confirmed.ok) {
        setPurchase({ state: 'failed', message: confirmed.error });
        return;
      }
      if (confirmed.data.status === 'paid') {
        if (confirmed.data.credits) setBalance(confirmed.data.credits);
        setPurchase({
          state: 'paid',
          credits: pack,
          ...(confirmed.data.invoiceId ? { invoiceId: confirmed.data.invoiceId } : {}),
          ...(confirmed.data.invoiceNumber ? { invoiceNumber: confirmed.data.invoiceNumber } : {}),
        });
        toast.success(`${pack} credits added`);
        router.refresh();
      } else if (confirmed.data.status === 'pending') {
        setPurchase({ state: 'pending' });
      } else {
        setPurchase({
          state: 'failed',
          message:
            'The payment did not go through and nothing was charged. If money left your account, it is returned by your bank within a few days.',
        });
      }
    });
  }

  const invoiceHref = (id: string) => `/api/billing/workspaces/${workspaceId}/invoices/${id}`;

  return (
    <>
      <Card>
        <CardHeader
          title="Billing details"
          description="Printed on every tax invoice. Invoices are issued for buyers in India."
          action={
            <Button variant="secondary" size="sm" onClick={() => setSheet(true)}>
              <Pencil aria-hidden className="h-4 w-4" />
              {details ? 'Edit' : 'Add details'}
            </Button>
          }
        />
        <CardBody>
          {details ? (
            <Address details={details} />
          ) : (
            <p className="text-sm text-muted">
              Add the legal name and address to bill before your first purchase. A GSTIN is
              optional.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Aadhaar eSign credits"
          description="One credit pays for one completed Aadhaar eSign. Credits do not expire."
          action={offer.testMode ? <Badge tone="warning">Test mode</Badge> : undefined}
        />
        <CardBody className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line px-4 py-3">
              <dt className="text-[12px] text-muted">Credits left</dt>
              <dd className="font-display text-2xl font-bold" data-testid="credits-available">
                {balance.available}
              </dd>
            </div>
            <div className="rounded-lg border border-line px-4 py-3">
              <dt className="text-[12px] text-muted">Held for eSigns in progress</dt>
              <dd className="font-display text-2xl font-bold" data-testid="credits-reserved">
                {balance.reserved}
              </dd>
            </div>
            <div className="col-span-2 rounded-lg border border-line px-4 py-3 sm:col-span-1">
              <dt className="text-[12px] text-muted">Price</dt>
              <dd className="text-[17px] leading-8 font-semibold" data-testid="credit-price">
                {offer.pricePaise === null
                  ? 'Price coming soon'
                  : `${formatInr(offer.pricePaise)} per eSign`}
              </dd>
            </div>
          </dl>

          {canBuy ? (
            <div className="space-y-4">
              <fieldset>
                <legend className="text-sm font-semibold">Buy a pack</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {offer.packs.map((size) => (
                    <label
                      key={size}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm',
                        pack === size ? 'border-primary bg-primary-soft' : 'border-line-strong',
                      )}
                    >
                      <input
                        type="radio"
                        name="pack"
                        value={size}
                        checked={pack === size}
                        onChange={() => setPack(size)}
                        className="accent-[var(--primary)]"
                      />
                      <span>
                        <span className="block font-semibold">{size} credits</span>
                        <span className="text-muted">
                          {formatInr((offer.pricePaise ?? 0) * size)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {tax ? (
                <dl
                  className="space-y-1 rounded-lg bg-surface-2/60 px-4 py-3 text-sm"
                  data-testid="pack-summary"
                >
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">
                      {pack} credits at {formatInr(offer.pricePaise ?? 0)}
                    </dt>
                    <dd>{formatInr(tax.taxablePaise)}</dd>
                  </div>
                  {details && tax.kind === 'intra' ? (
                    <>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">CGST {tax.cgstPercent}%</dt>
                        <dd>{formatInr(tax.cgstPaise)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">SGST {tax.sgstPercent}%</dt>
                        <dd>{formatInr(tax.sgstPaise)}</dd>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">
                        {details ? 'IGST' : 'GST'} {offer.gstPercent}%
                      </dt>
                      <dd>{formatInr(tax.taxPaise)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
                    <dt>Amount to pay</dt>
                    <dd data-testid="pack-total">{formatInr(tax.totalPaise)}</dd>
                  </div>
                </dl>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={buy} pending={buying} data-testid="buy-credits">
                  {details ? `Pay ${tax ? formatInr(tax.totalPaise) : ''}` : 'Add billing details'}
                </Button>
                <p className="text-[13px] text-muted">
                  Paid through Razorpay by UPI, card or net banking. The tax invoice is emailed to{' '}
                  {details?.email ?? 'your billing email'}.
                </p>
              </div>
            </div>
          ) : (
            <p
              role="status"
              data-testid="credits-unavailable"
              className="rounded-lg border border-line bg-surface-2/60 px-4 py-3 text-sm text-ink"
            >
              {UNAVAILABLE[offer.unavailable ?? 'price_not_set']}
            </p>
          )}

          {purchase.state === 'paid' ? (
            <p
              role="status"
              data-testid="purchase-paid"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success-soft px-4 py-3 text-sm"
            >
              <CircleCheck aria-hidden className="h-4 w-4 text-success" />
              Payment received. {purchase.credits} credits were added.
              {purchase.invoiceId ? (
                <a
                  className="font-semibold text-primary hover:underline"
                  href={invoiceHref(purchase.invoiceId)}
                >
                  Download invoice {purchase.invoiceNumber}
                </a>
              ) : null}
            </p>
          ) : null}
          {purchase.state === 'pending' ? (
            <p
              role="status"
              data-testid="purchase-pending"
              className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm"
            >
              <Clock aria-hidden className="h-4 w-4 shrink-0" />
              Your bank is still confirming the payment. The credits are added on their own as soon
              as it does; there is no need to pay again.
            </p>
          ) : null}
          {purchase.state === 'failed' ? (
            <p
              role="alert"
              data-testid="purchase-failed"
              className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {purchase.message}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Invoices" description="Every purchase, with its GST tax invoice." />
        {overview.invoices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm" data-testid="invoices">
              <thead className="border-b border-line text-[12px] text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">For</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overview.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-5 py-3 font-medium whitespace-nowrap">
                      {invoice.number} {invoice.test ? <Badge tone="warning">Test</Badge> : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <LocalTime iso={invoice.issuedAt} format="day" />
                    </td>
                    <td className="px-3 py-3 text-muted">{invoice.description}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {formatInr(invoice.totalPaise)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <a
                        href={invoiceHref(invoice.id)}
                        className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                        aria-label={`Download invoice ${invoice.number}`}
                      >
                        <Download aria-hidden className="h-4 w-4" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={ReceiptText}
              title="No invoices yet"
              description="An invoice appears here, and in your billing email, after each purchase."
            />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Credit history" description="The latest 100 changes, newest first." />
        {history.length ? (
          <ul className="divide-y divide-line" data-testid="credit-history">
            {history.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  {ENTRY_LABELS[entry.kind]}
                  <span className="text-muted">
                    {' · '}
                    <LocalTime iso={entry.createdAt} format="short" />
                  </span>
                </span>
                <span className="font-mono text-[13px]">
                  {ENTRY_SIGN[entry.kind]}
                  {entry.credits}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody>
            <p className="text-sm text-muted">No credits bought or used yet.</p>
          </CardBody>
        )}
      </Card>

      <DialogRoot
        open={sheet}
        onOpenChange={(next) => {
          setSheet(next);
          if (!next) save.clear();
        }}
      >
        <SheetContent
          title="Billing details"
          description="Who the tax invoice is made out to. For buyers in India only."
        >
          <form onSubmit={saveDetails} className="space-y-4" data-testid="billing-details-form">
            <Field label="Legal name" error={save.errors.legalName}>
              {(props) => (
                <Input
                  {...props}
                  name="legalName"
                  defaultValue={details?.legalName ?? ''}
                  autoComplete="organization"
                  required
                />
              )}
            </Field>
            <Field
              label="GSTIN (optional)"
              hint="15 characters. Leave empty if you are not registered for GST."
              error={save.errors.gstin}
            >
              {(props) => (
                <Input
                  {...props}
                  name="gstin"
                  defaultValue={details?.gstin ?? ''}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={15}
                  className="uppercase"
                />
              )}
            </Field>
            <Field label="Address" error={save.errors.addressLine1}>
              {(props) => (
                <Input
                  {...props}
                  name="addressLine1"
                  defaultValue={details?.addressLine1 ?? ''}
                  autoComplete="address-line1"
                  required
                />
              )}
            </Field>
            <Field label="Address line 2 (optional)" error={save.errors.addressLine2}>
              {(props) => (
                <Input
                  {...props}
                  name="addressLine2"
                  defaultValue={details?.addressLine2 ?? ''}
                  autoComplete="address-line2"
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" error={save.errors.city}>
                {(props) => (
                  <Input
                    {...props}
                    name="city"
                    defaultValue={details?.city ?? ''}
                    autoComplete="address-level2"
                    required
                  />
                )}
              </Field>
              <Field label="PIN code" error={save.errors.pin}>
                {(props) => (
                  <Input
                    {...props}
                    name="pin"
                    defaultValue={details?.pin ?? ''}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={6}
                    required
                  />
                )}
              </Field>
            </div>
            <Field
              label="State or union territory"
              hint="Decides whether the invoice shows CGST and SGST, or IGST."
              error={save.errors.stateCode}
            >
              {(props) => (
                <NativeSelect
                  {...props}
                  name="stateCode"
                  defaultValue={details?.stateCode ?? ''}
                  required
                >
                  <option value="" disabled>
                    Choose a state
                  </option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Billing email" hint="Invoices are sent here." error={save.errors.email}>
              {(props) => (
                <Input
                  {...props}
                  name="email"
                  type="email"
                  defaultValue={details?.email ?? ''}
                  autoComplete="email"
                  required
                />
              )}
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" pending={save.pending}>
                Save details
              </Button>
            </div>
          </form>
        </SheetContent>
      </DialogRoot>
    </>
  );
}
