'use client';

import { Check, ChevronDown, Minus, Server, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { INSTALL_HELP_HOURS } from '@/lib/billing/install-help';
import type { PlanFeature } from '@/lib/plans';
import type { PricingView } from '@/server/billing/pricing';
import { ExternalLink } from './external-link';
import { CONTACT_EMAIL, GITHUB_URL } from './links';

type Term = 'month' | 'year';
type Column = 'free' | 'cloud' | 'selfHosted';

/** The rows each plan card shows; the full comparison has every row. */
const ESSENTIALS: Record<Column, PlanFeature['key'][]> = {
  free: ['ownedWorkspaces', 'envelopesPerMonth', 'members', 'aadhaarEsign'],
  cloud: ['ownedWorkspaces', 'envelopesPerMonth', 'members', 'aadhaarEsign'],
  selfHosted: ['envelopesPerMonth', 'members', 'storageBytes', 'aadhaarEsign'],
};

/** The ask for a hosting discount link when no partner offer is configured yet. */
export const HOSTING_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('VPS hosting discount link')}`;

/**
 * What a row says for one plan. On the cards the Aadhaar eSign row is only the price of one
 * eSign on that plan, as the operator set it, or that the price is coming.
 */
function cardValue(row: PlanFeature, column: Column, pricing: PricingView): string {
  if (row.key === 'aadhaarEsign' && column === 'free') return pricing.esignFree;
  if (row.key === 'aadhaarEsign' && column === 'cloud') return pricing.esignCloud;
  if (row.key === 'members' && column === 'cloud') {
    return `${pricing.includedMembers} included, then ${pricing.extraMember} each a month`;
  }
  return row[column];
}

const notIncluded = (value: string) => value === 'Not included';

function Essentials({
  rows,
  column,
  pricing,
}: {
  rows: PlanFeature[];
  column: Column;
  pricing: PricingView;
}) {
  const shown = ESSENTIALS[column]
    .map((key) => rows.find((row) => row.key === key))
    .filter((row): row is PlanFeature => row !== undefined);
  return (
    <dl className="mt-6 flex-1 space-y-3 border-t border-line pt-5 text-sm">
      {shown.map((row) => (
        <div key={row.key}>
          <dt className="flex items-center gap-2.5 text-[13px] text-muted">
            <Check aria-hidden className="h-4 w-4 shrink-0 text-success" />
            {row.label}
          </dt>
          <dd className="mt-0.5 pl-[1.625rem] font-semibold">{cardValue(row, column, pricing)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlanCard({
  name,
  featured,
  children,
}: {
  name: string;
  featured?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="plan-slot flex min-w-0">
      <article
        aria-label={featured ? `${name}, recommended` : name}
        className={cn(
          'plan-card paper relative flex w-full flex-col rounded-[8px] bg-surface p-6 text-ink ring-1 ring-line sm:p-7',
          featured &&
            'plan-featured shadow-[0_24px_48px_-28px_rgb(13_27_42/0.55)] ring-2 ring-primary',
        )}
      >
        <div className="flex min-h-7 items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{name}</h3>
          {featured ? (
            <span className="plan-flag rounded-[3px] bg-primary px-2 py-1 text-xs font-semibold text-primary-ink">
              Recommended
            </span>
          ) : null}
        </div>
        {children}
      </article>
    </div>
  );
}

function TermSwitch({
  term,
  onChange,
  saving,
}: {
  term: Term;
  onChange: (term: Term) => void;
  saving: string | null;
}) {
  const option = (value: Term, label: ReactNode) => (
    <button
      type="button"
      aria-pressed={term === value}
      onClick={() => onChange(value)}
      className={cn(
        'flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[4px] px-3 text-sm font-semibold whitespace-nowrap',
        term === value
          ? 'bg-primary text-primary-ink shadow-[0_1px_2px_rgb(13_27_42/0.18)]'
          : 'text-muted hover:text-ink',
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Pay for Cloud by the month or the year"
      className="plan-toggle mt-4 flex gap-1 rounded-[6px] bg-surface-2 p-1"
    >
      {option('month', 'Monthly')}
      {option(
        'year',
        <>
          Annual
          {saving ? (
            <span className={cn('text-xs font-semibold', term !== 'year' && 'text-success')}>
              {saving}
            </span>
          ) : null}
        </>,
      )}
    </div>
  );
}

function Comparison({
  id,
  rows,
  pricing,
  term,
}: {
  id: string;
  rows: PlanFeature[];
  pricing: PricingView;
  term: Term;
}) {
  const price: Omit<PlanFeature, 'key'> & { key: string } = {
    key: 'price',
    label: 'Price',
    free: '₹0',
    cloud: term === 'year' ? `${pricing.cloudYear} a year` : `${pricing.cloudMonth} a month`,
    selfHosted: 'Free, open source',
  };
  const columns: { key: Column; name: string }[] = [
    { key: 'free', name: 'Free' },
    { key: 'cloud', name: 'Cloud' },
    { key: 'selfHosted', name: 'Self-hosted' },
  ];
  return (
    <div
      id={id}
      className="paper mt-6 overflow-hidden rounded-[8px] bg-surface text-ink ring-1 ring-line"
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Everything in Free, Cloud and Self-hosted</caption>
        <thead className="hidden border-b border-line bg-surface-2 sm:table-header-group">
          <tr>
            <th scope="col" className="w-[28%] px-5 py-3 font-semibold text-muted">
              What you get
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-5 py-3 font-display font-semibold">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[price, ...rows].map((row) => (
            <tr key={row.key} className="grid gap-1 px-5 py-3.5 sm:table-row sm:p-0">
              <th
                scope="row"
                className="font-semibold sm:px-5 sm:py-3 sm:font-normal sm:text-muted"
              >
                {row.label}
              </th>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'flex gap-1.5 sm:table-cell sm:px-5 sm:py-3',
                    column.key === 'cloud' && 'font-medium',
                    notIncluded(row[column.key]) && 'text-muted',
                  )}
                >
                  <span className="w-24 shrink-0 text-[13px] font-normal text-muted sm:hidden">
                    {column.name}
                  </span>
                  <span className="flex gap-1.5">
                    {notIncluded(row[column.key]) ? (
                      <Minus aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : null}
                    {row[column.key]}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The plans as three cards with only what matters for choosing, a switch between paying for
 * Cloud by the month or the year, and the full comparison one click away.
 */
export function PricingPlans({
  rows,
  pricing,
  start,
  signedIn,
}: {
  /** The comparison rows with the eSign prices filled in, from `pricedFeatures`. */
  rows: PlanFeature[];
  pricing: PricingView;
  start: { href: string; label: string };
  signedIn: boolean;
}) {
  const [term, setTerm] = useState<Term>('month');
  const [open, setOpen] = useState(false);
  const tableId = useId();
  const yearly = term === 'year';
  const savingBadge =
    pricing.yearSavingAmount && pricing.yearSaving
      ? `Save ${pricing.yearSavingAmount} a year (${pricing.yearSaving})`
      : null;

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-stretch">
        <PlanCard name="Free">
          <p className="mt-4 font-display text-4xl font-bold tracking-tight tabular-nums">₹0</p>
          <p className="mt-2 text-muted">For trying it out and for small teams. No card needed.</p>
          <Essentials rows={rows} column="free" pricing={pricing} />
          <Button asChild variant="secondary" className="plan-cta mt-8 h-11 w-full">
            <Link href={start.href}>{start.label}</Link>
          </Button>
        </PlanCard>

        <PlanCard name="Cloud" featured>
          <TermSwitch term={term} onChange={setTerm} saving={pricing.yearSaving} />
          <p
            aria-live="polite"
            className="mt-4 font-display text-4xl font-bold tracking-tight tabular-nums"
          >
            {yearly ? pricing.cloudYear : pricing.cloudMonth}
            <span className="ml-2 font-sans text-base font-normal text-muted">
              {yearly ? 'a year' : 'a month'}
            </span>
          </p>
          <p className="mt-2 min-h-6 text-sm">
            {savingBadge ? (
              yearly ? (
                <span className="rounded-[3px] bg-success-soft px-2 py-0.5 font-semibold text-success">
                  {savingBadge}
                </span>
              ) : (
                <span className="text-muted">
                  Pay for a year and save {pricing.yearSavingAmount}
                </span>
              )
            ) : null}
          </p>
          <p className="mt-2 text-muted">
            Your account and every workspace in it, plus {pricing.gstPercent}% GST.
          </p>
          <Essentials rows={rows} column="cloud" pricing={pricing} />
          <Button asChild className="plan-cta mt-8 h-11 w-full">
            <Link href={start.href}>
              {signedIn ? 'Upgrade in your workspace' : 'Start free, upgrade any time'}
            </Link>
          </Button>
          <p className="mt-2 text-center text-[13px] text-muted">
            {pricing.paymentsOpen
              ? 'No automatic charge. Cancel any time.'
              : 'Paying for Cloud opens shortly.'}
          </p>
        </PlanCard>

        <PlanCard name="Self-hosted">
          <p className="mt-4 font-display text-4xl font-bold tracking-tight">Free</p>
          <p className="mt-2 text-muted">On your own server, under the open-source licences.</p>
          <Essentials rows={rows} column="selfHosted" pricing={pricing} />
          <Button asChild variant="secondary" className="plan-cta mt-8 h-11 w-full">
            <ExternalLink href={GITHUB_URL} bare>
              Self-host it
            </ExternalLink>
          </Button>
          <div className="plan-help mt-5 rounded-[6px] bg-primary-soft p-4">
            <p className="flex items-center gap-2 font-display font-semibold">
              <Wrench aria-hidden className="h-4 w-4 shrink-0 text-primary" />
              Need help installing?
            </p>
            <p className="mt-1.5 text-sm">
              An experienced engineer installs it on your server within {INSTALL_HELP_HOURS} working
              hours for a flat {pricing.installHelp} + GST.
            </p>
            <Button asChild className="mt-3 h-10 w-full">
              <Link href="/install-help">Book installation help</Link>
            </Button>
          </div>
        </PlanCard>
      </div>

      <div className="plan-hosting mt-5 flex flex-col gap-3 rounded-[8px] border border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2.5 font-semibold">
          <Server aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Need a server? Get VPS hosting from our partners with an extra 20% discount.
        </p>
        {pricing.hostingOffers.length > 0 ? (
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
            {pricing.hostingOffers.map((offer) => (
              <li key={offer.url}>
                <ExternalLink
                  href={offer.url}
                  className="text-primary underline underline-offset-2 hover:no-underline"
                >
                  {offer.name}
                </ExternalLink>
                {offer.note ? (
                  <span className="ml-1.5 font-normal text-muted">{offer.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">
            <a
              href={HOSTING_MAILTO}
              className="font-semibold text-primary underline underline-offset-2 hover:no-underline"
            >
              Ask us for the discount link
            </a>
            <span className="text-muted"> at </span>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-semibold text-primary underline underline-offset-2 hover:no-underline"
            >
              {CONTACT_EMAIL}
            </a>
          </p>
        )}
      </div>

      <div className="mt-8 flex justify-center">
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={tableId}
          onClick={() => setOpen((value) => !value)}
          className="h-11 px-5"
        >
          {open ? 'Hide the full comparison' : 'See everything included'}
          <ChevronDown
            aria-hidden
            className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')}
          />
        </Button>
      </div>
      {open ? (
        <Comparison id={tableId} rows={rows} pricing={pricing} term={term} />
      ) : (
        <div id={tableId} hidden />
      )}
    </div>
  );
}
