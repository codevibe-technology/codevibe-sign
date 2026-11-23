'use client';

import { CircleCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { openCheckout } from '@/components/billing/razorpay-checkout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { INDIAN_STATES } from '@/lib/billing/gst';
import { installBookingSchema } from '@/lib/billing/install-help';
import { bookInstallHelpAction, confirmInstallHelpAction } from '@/server/actions/install-help';

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  legalName: '',
  gstin: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  pin: '',
  stateCode: '',
  provider: '',
  serverDetails: '',
  preferredTime: '',
};

type Values = typeof EMPTY;

/**
 * The booking form for installation help: who to contact, who to invoice, where the server
 * is and when. It never asks for a password or a key. Continuing opens the payment window;
 * the booking counts once the server has confirmed the payment.
 */
export function InstallHelpForm({
  price,
  gstPercent,
  testMode,
}: {
  /** The price as text, before GST: `₹1,999`. */
  price: string;
  gstPercent: number;
  testMode: boolean;
}) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ invoiceNumber?: string | undefined; pending: boolean } | null>(
    null,
  );

  const bind = (key: keyof Values) => ({
    name: key,
    value: values[key],
    onChange: (event: { target: { value: string } }) => {
      setValues((current) => ({ ...current, [key]: event.target.value }));
      setErrors((current) => ({ ...current, [key]: undefined }));
    },
  });

  function focusFirst(found: Partial<Record<keyof Values, string>>) {
    const first = (Object.keys(EMPTY) as (keyof Values)[]).find((key) => found[key]);
    if (first) document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = installBookingSchema.safeParse(values);
    if (!parsed.success) {
      const found: Partial<Record<keyof Values, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Values;
        found[key] ??= issue.message;
      }
      setErrors(found);
      focusFirst(found);
      return;
    }
    setBusy(true);
    try {
      const opened = await bookInstallHelpAction(values);
      if (!opened.ok) {
        if (opened.field && opened.field in EMPTY) {
          const found = { [opened.field]: opened.error };
          setErrors(found);
          focusFirst(found);
        } else toast.error(opened.error);
        return;
      }
      const payment = await openCheckout(opened.data);
      if (!payment) return;
      const confirmed = await confirmInstallHelpAction(payment);
      if (!confirmed.ok) toast.error(confirmed.error);
      else if (confirmed.data.status === 'failed') {
        toast.error('The payment did not go through. Nothing was charged.');
      } else {
        setDone({
          invoiceNumber: confirmed.data.invoiceNumber,
          pending: confirmed.data.status === 'pending',
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The payment window could not open.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-xl border border-success/40 bg-success-soft px-6 py-8 text-center"
      >
        <CircleCheck aria-hidden className="mx-auto h-10 w-10 text-success" />
        <h2 className="mt-3 text-xl font-semibold">
          {done.pending ? 'Your payment is being confirmed' : 'Your installation is booked'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-muted">
          {done.pending
            ? 'This can take a minute. The booking is confirmed by email as soon as the payment arrives.'
            : `We will write to ${values.email} to arrange access to the server and the time.${done.invoiceNumber ? ` Tax invoice ${done.invoiceNumber} is on its way to the same address.` : ''}`}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">Who we talk to</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" error={errors.name}>
            {(props) => <Input {...props} {...bind('name')} autoComplete="name" />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(props) => (
              <Input {...props} {...bind('phone')} type="tel" autoComplete="tel" inputMode="tel" />
            )}
          </Field>
        </div>
        <Field
          label="Email"
          hint="The booking, the invoice and our messages go here."
          error={errors.email}
        >
          {(props) => <Input {...props} {...bind('email')} type="email" autoComplete="email" />}
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">Who the invoice is for</legend>
        <Field label="Company or legal name" error={errors.legalName}>
          {(props) => <Input {...props} {...bind('legalName')} autoComplete="organization" />}
        </Field>
        <Field
          label="GSTIN (optional)"
          hint="Leave it empty if you are not registered for GST."
          error={errors.gstin}
        >
          {(props) => <Input {...props} {...bind('gstin')} maxLength={15} className="uppercase" />}
        </Field>
        <Field label="Billing address" error={errors.addressLine1}>
          {(props) => <Input {...props} {...bind('addressLine1')} autoComplete="address-line1" />}
        </Field>
        <Field label="Address line 2 (optional)" error={errors.addressLine2}>
          {(props) => <Input {...props} {...bind('addressLine2')} autoComplete="address-line2" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" error={errors.city}>
            {(props) => <Input {...props} {...bind('city')} autoComplete="address-level2" />}
          </Field>
          <Field label="PIN code" error={errors.pin}>
            {(props) => (
              <Input
                {...props}
                {...bind('pin')}
                inputMode="numeric"
                maxLength={6}
                autoComplete="postal-code"
              />
            )}
          </Field>
          <Field label="State" error={errors.stateCode}>
            {(props) => (
              <NativeSelect {...props} {...bind('stateCode')}>
                <option value="">Pick a state</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <p className="text-[13px] text-muted">Invoices are issued for buyers in India only.</p>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">The server</legend>
        <Field
          label="Where is it?"
          hint="The hosting company or cloud, or your own office."
          error={errors.provider}
        >
          {(props) => <Input {...props} {...bind('provider')} />}
        </Field>
        <Field
          label="About the server"
          hint="Operating system, memory and the domain you want to use. Do not put passwords or keys here: we arrange access with you safely after booking."
          error={errors.serverDetails}
        >
          {(props) => <Textarea {...props} {...bind('serverDetails')} maxLength={1000} />}
        </Field>
        <Field
          label="When suits you?"
          hint="A date and a time in India time, on a working day."
          error={errors.preferredTime}
        >
          {(props) => <Input {...props} {...bind('preferredTime')} />}
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <p className="text-muted">
          <span className="font-display text-2xl font-bold text-ink">{price}</span> plus{' '}
          {gstPercent}% GST
          {testMode ? (
            <span className="ml-3">
              <Badge tone="warning">Test mode</Badge>
            </span>
          ) : null}
        </p>
        <Button type="submit" pending={busy} className="h-11 px-6">
          Continue to payment
        </Button>
      </div>
    </form>
  );
}
