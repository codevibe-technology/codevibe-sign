'use client';

import {
  ArrowDown,
  ArrowUp,
  Fingerprint,
  GripVertical,
  Link2,
  ListOrdered,
  MailCheck,
  Plus,
  Smartphone,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { RoutingMode } from '@codevibe_technology/sign-core';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { AadhaarPlacementNote } from './aadhaar-note';
import { formatInr } from '@/lib/billing/money';
import { cn } from '@/lib/cn';
import { AUTH_LABELS, AUTH_OPTIONS, ROLE_OPTIONS } from '@/lib/envelopes';
import {
  MAX_RECIPIENTS,
  moveItem,
  newRecipient,
  type DraftRecipient,
  type Problems,
} from '@/lib/send-flow';

/** Whether Aadhaar eSign can be chosen for a signer, and what it costs the workspace. */
export interface EsignChoice {
  available: boolean;
  /** Why not, in words for the sender. */
  message: string | null;
  /** eSigns use prepaid credits here. */
  creditsRequired: boolean;
  credits: number;
  /** Price of one eSign before tax; null shows as "Price coming soon". */
  pricePaise: number | null;
  /** Settings, Aadhaar eSign, for someone who may open it; null otherwise. */
  settingsHref: string | null;
}

const AUTH_HINTS = {
  email_link: 'The link in their email is enough. Weaker evidence: anyone with the email can sign.',
  email_otp: 'They also enter a code we email them.',
  sms_otp: 'They also enter a code we text to their phone.',
  aadhaar:
    "They confirm with a one-time code from Aadhaar on the eSign provider's page. One signer per envelope, on one document, and they sign last.",
} as const;

function EsignNote({ esign }: { esign: EsignChoice | undefined }) {
  if (!esign) return null;
  const settings = esign.settingsHref ? (
    <Link className="font-semibold text-primary hover:underline" href={esign.settingsHref}>
      Open Aadhaar eSign settings
    </Link>
  ) : null;
  if (!esign.available) {
    return (
      <p
        className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-3 text-[13px] text-ink sm:col-span-2"
        data-testid="esign-unavailable"
      >
        <Fingerprint aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span>
          {esign.message} {settings}
        </span>
      </p>
    );
  }
  if (!esign.creditsRequired) return null;
  const low = esign.credits < 1;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/25 bg-primary-soft px-3.5 py-3 text-[13px] text-ink sm:col-span-2"
      data-testid="esign-cost"
    >
      <Fingerprint aria-hidden className="h-5 w-5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">
        Uses 1 credit when they finish signing
        {esign.pricePaise === null ? '' : ` (${formatInr(esign.pricePaise)} per eSign)`}. This
        workspace has {esign.credits} {esign.credits === 1 ? 'credit' : 'credits'} left.
      </p>
      <span
        className={cn(
          'rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold',
          low ? 'bg-danger text-white' : 'bg-surface text-primary',
        )}
      >
        {esign.credits} {esign.credits === 1 ? 'credit' : 'credits'}
      </span>
      {settings}
    </div>
  );
}

/** Index of the recipient's colour in the field placer: signers and approvers, in order. */
export function colorIndex(recipients: DraftRecipient[], id: string): number | null {
  const actors = recipients.filter((r) => r.role !== 'viewer');
  const i = actors.findIndex((r) => r.id === id);
  return i < 0 ? null : i % 6;
}

export function RecipientDot({ index }: { index: number | null }) {
  return (
    <span
      aria-hidden
      className="h-3 w-3 shrink-0 rounded-full border border-line"
      style={index === null ? undefined : { background: `var(--cvs-recipient-${index})` }}
    />
  );
}

/** One or two capital letters for a recipient's avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts;
  return letters.map((p) => Array.from(p)[0]?.toUpperCase() ?? '').join('') || '?';
}

/** A recipient's initials in their placer colour; people who only get a copy are grey. */
export function RecipientAvatar({
  name,
  index,
  size = 'md',
}: {
  name: string;
  index: number | null;
  size?: 'xs' | 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white',
        size === 'xs' && 'h-5 w-5 text-[9.5px]',
        size === 'md' && 'h-8 w-8 text-[12px]',
        size === 'lg' && 'h-10 w-10 text-[13.5px]',
        index === null && 'bg-muted',
      )}
      style={
        index === null
          ? undefined
          : { background: `color-mix(in srgb, var(--cvs-recipient-${index}) 82%, black)` }
      }
    >
      {initials(name)}
    </span>
  );
}

const AUTH_ICONS = {
  email_otp: MailCheck,
  sms_otp: Smartphone,
  email_link: Link2,
  aadhaar: Fingerprint,
} as const;

/**
 * Step 2: who signs, approves or gets a copy, how each proves who they are, and the order.
 * Rows reorder by dragging the handle or with the arrow buttons.
 */
export function StepRecipients({
  recipients,
  routing,
  problems,
  me,
  esign,
  onChange,
  onRoutingChange,
}: {
  esign?: EsignChoice;
  recipients: DraftRecipient[];
  routing: RoutingMode;
  problems: Problems;
  me: { name: string; email: string };
  onChange: (update: (recipients: DraftRecipient[]) => DraftRecipient[]) => void;
  onRoutingChange: (routing: RoutingMode) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const sequential = routing === 'sequential';
  const update = (id: string, patch: Partial<DraftRecipient>) =>
    onChange((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const meAdded = recipients.some((r) => r.email.trim().toLowerCase() === me.email.toLowerCase());

  return (
    <div className="space-y-6">
      <fieldset className="grid gap-3 sm:grid-cols-2" data-tour="signing-order">
        <legend className="mb-2 text-[13px] font-semibold text-ink">Signing order</legend>
        {(
          [
            [
              'sequential',
              'One after another',
              'Each person gets the link when the one before has finished.',
              ListOrdered,
            ],
            [
              'parallel',
              'Everyone at once',
              'All signers get the link now and sign in any order.',
              UsersRound,
            ],
          ] as const
        ).map(([value, label, hint, Icon]) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-2xl border bg-surface p-4 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
              routing === value
                ? 'border-primary shadow-[inset_0_0_0_1px_var(--primary)]'
                : 'border-line hover:border-line-strong',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                routing === value ? 'bg-primary text-primary-ink' : 'bg-surface-2 text-muted',
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{label}</span>
              <span className="text-muted">{hint}</span>
            </span>
            <input
              type="radio"
              name="routing"
              value={value}
              checked={routing === value}
              onChange={() => onRoutingChange(value)}
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
          </label>
        ))}
      </fieldset>

      {problems.recipients ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {problems.recipients}
        </p>
      ) : null}

      <ol className="relative space-y-3" aria-label="Recipients" data-tour="recipients-list">
        {recipients.map((r, i) => {
          const at = `recipients.${r.id}`;
          const color = colorIndex(recipients, r.id);
          const label = r.name.trim() || `Recipient ${i + 1}`;
          const AuthIcon = AUTH_ICONS[r.auth];
          return (
            <li
              key={r.id}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                if (dragging !== i) {
                  onChange((list) => moveItem(list, dragging, i));
                  setDragging(i);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(null);
              }}
              className={cn(
                'relative flex gap-2 rounded-2xl border bg-surface shadow-card transition-shadow sm:gap-3',
                dragging === i ? 'border-primary ring-2 ring-primary/30' : 'border-line',
              )}
            >
              <span
                aria-hidden
                className="w-1.5 shrink-0 rounded-l-2xl"
                style={{
                  background:
                    color === null ? 'var(--line-strong)' : `var(--cvs-recipient-${color})`,
                }}
              />
              <div className="flex shrink-0 flex-col items-center gap-1 pt-4">
                <span
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDragging(i);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className="cursor-grab rounded p-1 text-muted hover:bg-surface-2 active:cursor-grabbing"
                  title="Drag to reorder"
                >
                  <GripVertical aria-hidden className="h-4 w-4" />
                </span>
                {sequential ? (
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 font-mono text-[11px] font-semibold text-ink"
                    title={`Signs ${i + 1}${i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'}`}
                  >
                    {i + 1}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1 py-4 pr-3 sm:pr-4">
                <div className="mb-3 flex items-center gap-3">
                  <RecipientAvatar name={label} index={color} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{label}</p>
                    <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted">
                      {ROLE_OPTIONS.find((o) => o.value === r.role)?.label}
                      {r.role === 'viewer' ? null : (
                        <>
                          <span aria-hidden>·</span>
                          <AuthIcon aria-hidden className="h-3.5 w-3.5" />
                          {AUTH_LABELS[r.auth]}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${r.name || `recipient ${i + 1}`} up`}
                      disabled={i === 0}
                      onClick={() => onChange((list) => moveItem(list, i, i - 1))}
                    >
                      <ArrowUp aria-hidden className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${r.name || `recipient ${i + 1}`} down`}
                      disabled={i === recipients.length - 1}
                      onClick={() => onChange((list) => moveItem(list, i, i + 1))}
                    >
                      <ArrowDown aria-hidden className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${r.name || `recipient ${i + 1}`}`}
                      className="hover:text-danger"
                      onClick={() => onChange((list) => list.filter((x) => x.id !== r.id))}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" error={problems[`${at}.name`]}>
                    {(props) => (
                      <Input
                        {...props}
                        value={r.name}
                        autoComplete="off"
                        placeholder="Asha Rao"
                        onChange={(e) => update(r.id, { name: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Email" error={problems[`${at}.email`]}>
                    {(props) => (
                      <Input
                        {...props}
                        type="email"
                        inputMode="email"
                        autoComplete="off"
                        value={r.email}
                        placeholder="asha@example.com"
                        onChange={(e) => update(r.id, { email: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Role" hint={ROLE_OPTIONS.find((o) => o.value === r.role)?.hint}>
                    {(props) => (
                      <NativeSelect
                        {...props}
                        value={r.role}
                        onChange={(e) =>
                          update(r.id, { role: e.target.value as DraftRecipient['role'] })
                        }
                      >
                        {ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                  {r.role === 'viewer' ? null : (
                    <Field
                      label="Identity check"
                      hint={AUTH_HINTS[r.auth]}
                      error={problems[`${at}.auth`]}
                    >
                      {(props) => (
                        <NativeSelect
                          {...props}
                          data-tour="identity-check"
                          value={r.auth}
                          onChange={(e) =>
                            update(r.id, { auth: e.target.value as DraftRecipient['auth'] })
                          }
                        >
                          {AUTH_OPTIONS.map((o) => (
                            <option
                              key={o.value}
                              value={o.value}
                              disabled={
                                o.value === 'aadhaar' &&
                                r.auth !== 'aadhaar' &&
                                esign?.available === false
                              }
                            >
                              {o.value === 'aadhaar' && esign?.available === false
                                ? `${o.label} (not available)`
                                : o.value === 'aadhaar' &&
                                    esign?.creditsRequired &&
                                    esign.pricePaise !== null
                                  ? `${o.label} (${formatInr(esign.pricePaise)} each)`
                                  : o.label}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    </Field>
                  )}
                  {r.auth === 'aadhaar' && r.role !== 'viewer' ? (
                    <>
                      <EsignNote esign={esign} />
                      <AadhaarPlacementNote className="sm:col-span-2" />
                    </>
                  ) : null}
                  {r.auth === 'sms_otp' && r.role !== 'viewer' ? (
                    <Field
                      label="Mobile number"
                      hint="With the country code, for example +919812345678."
                      error={problems[`${at}.phone`]}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          type="tel"
                          inputMode="tel"
                          value={r.phone}
                          placeholder="+91…"
                          onChange={(e) => update(r.id, { phone: e.target.value })}
                        />
                      )}
                    </Field>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {recipients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
          <span
            aria-hidden
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary"
          >
            <UsersRound className="h-6 w-6" />
          </span>
          <p className="mt-3 font-semibold text-ink">Nobody added yet</p>
          <p className="mt-1 text-sm text-muted">
            Add the people who sign, approve or get a copy. You can add up to {MAX_RECIPIENTS}.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" data-tour="recipients-add">
        <Button
          type="button"
          variant="secondary"
          disabled={recipients.length >= MAX_RECIPIENTS}
          onClick={() => onChange((list) => [...list, newRecipient()])}
        >
          <Plus aria-hidden className="h-4 w-4" />
          Add recipient
        </Button>
        {meAdded ? null : (
          <Button
            type="button"
            variant="ghost"
            disabled={recipients.length >= MAX_RECIPIENTS}
            onClick={() =>
              onChange((list) => [...list, { ...newRecipient(), name: me.name, email: me.email }])
            }
          >
            <UserRound aria-hidden className="h-4 w-4" />
            Add me
          </Button>
        )}
      </div>
    </div>
  );
}
