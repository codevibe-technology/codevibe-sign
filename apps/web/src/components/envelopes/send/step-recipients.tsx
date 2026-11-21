'use client';

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { RoutingMode } from '@codevibe_technology/sign-core';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { AUTH_OPTIONS, ROLE_OPTIONS } from '@/lib/envelopes';
import {
  MAX_RECIPIENTS,
  moveItem,
  newRecipient,
  type DraftRecipient,
  type Problems,
} from '@/lib/send-flow';

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

/**
 * Step 2: who signs, approves or gets a copy, how each proves who they are, and the order.
 * Rows reorder by dragging the handle or with the arrow buttons.
 */
export function StepRecipients({
  recipients,
  routing,
  problems,
  me,
  onChange,
  onRoutingChange,
}: {
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
    <div className="space-y-4">
      <Card className="p-4">
        <fieldset>
          <legend className="text-sm font-semibold">Signing order</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(
              [
                [
                  'sequential',
                  'One after another',
                  'Each person gets the link when the one before has finished.',
                ],
                [
                  'parallel',
                  'Everyone at once',
                  'All signers get the link now and sign in any order.',
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm',
                  routing === value ? 'border-primary bg-primary-soft' : 'border-line-strong',
                )}
              >
                <input
                  type="radio"
                  name="routing"
                  value={value}
                  checked={routing === value}
                  onChange={() => onRoutingChange(value)}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      {problems.recipients ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {problems.recipients}
        </p>
      ) : null}

      <ol className="space-y-3" aria-label="Recipients">
        {recipients.map((r, i) => {
          const at = `recipients.${r.id}`;
          const color = colorIndex(recipients, r.id);
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
                'rounded-xl border bg-surface p-4 shadow-card transition-shadow',
                dragging === i ? 'border-primary ring-2 ring-primary/30' : 'border-line',
              )}
            >
              <div className="mb-3 flex items-center gap-2">
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
                <span className="flex h-6 min-w-6 items-center justify-center rounded-[3px] bg-surface-2 px-1.5 font-mono text-[11px] font-semibold text-ink">
                  {sequential ? i + 1 : '•'}
                </span>
                <RecipientDot index={color} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {r.name.trim() || `Recipient ${i + 1}`}
                </span>
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
                  onClick={() => onChange((list) => list.filter((x) => x.id !== r.id))}
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                </Button>
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
                    hint={
                      r.auth === 'email_link'
                        ? 'The link in their email is enough. Weaker evidence: anyone with the email can sign.'
                        : r.auth === 'email_otp'
                          ? 'They also enter a code we email them.'
                          : 'They also enter a code we text to their phone.'
                    }
                  >
                    {(props) => (
                      <NativeSelect
                        {...props}
                        value={r.auth}
                        onChange={(e) =>
                          update(r.id, { auth: e.target.value as DraftRecipient['auth'] })
                        }
                      >
                        {AUTH_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
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
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
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
