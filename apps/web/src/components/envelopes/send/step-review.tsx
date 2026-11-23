'use client';

import { AlarmClock, BellRing, FileText, Mail, PenLine, ShieldCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { AUTH_LABELS, ROLE_OPTIONS } from '@/lib/envelopes';
import {
  EXPIRY_OPTIONS,
  CHANGE_NOTE_MAX,
  MESSAGE_MAX,
  REMINDER_OPTIONS,
  TITLE_MAX,
  type DraftSettings,
  type Problems,
  type SendFlowState,
  type StepKey,
} from '@/lib/send-flow';
import { RecipientAvatar, colorIndex } from './step-recipients';

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

function Panel({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] leading-6 font-semibold text-ink">{title}</h3>
          {description ? <p className="text-[13px] text-muted">{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

/** Step 4: the email as recipients get it, who does what, and when the links stop working. */
export function StepReview({
  state,
  problems,
  sender,
  onSettings,
  onGoTo,
}: {
  state: SendFlowState;
  problems: Problems;
  /** Who the email comes from. */
  sender?: { name: string; email: string };
  onSettings: (patch: Partial<DraftSettings>) => void;
  onGoTo: (step: StepKey) => void;
}) {
  const { settings } = state;
  const elsewhere = Object.entries(problems).filter(
    ([key]) => !['title', 'message', 'changeNote', 'expiresInDays'].includes(key),
  );
  const expiryOptions = EXPIRY_OPTIONS.includes(settings.expiresInDays as never)
    ? EXPIRY_OPTIONS
    : [...EXPIRY_OPTIONS, settings.expiresInDays].sort((a, b) => a - b);
  const pages = state.documents.reduce((n, d) => n + d.pages.length, 0);
  const actors = state.recipients.filter((r) => r.role !== 'viewer');

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        {elsewhere.length > 0 ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            <p className="font-semibold">Fix these before sending:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {elsewhere.map(([key, message]) => {
                const step: StepKey = key.startsWith('fields')
                  ? 'fields'
                  : key.startsWith('recipients')
                    ? 'recipients'
                    : 'documents';
                return (
                  <li key={key}>
                    {message}{' '}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => onGoTo(step)}
                    >
                      Fix
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <Panel
          icon={<Mail className="h-[18px] w-[18px]" />}
          title="The email"
          description="What recipients see when the link arrives."
        >
          <div className="space-y-4 px-5 py-5">
            <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13.5px]">
              <dt className="text-muted">From</dt>
              <dd className="min-w-0 truncate text-ink">
                {sender ? `${sender.name || sender.email} via Codevibe Sign` : 'Codevibe Sign'}
              </dd>
              <dt className="text-muted">To</dt>
              <dd className="flex min-w-0 flex-wrap gap-1.5">
                {state.recipients.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pr-2.5 pl-0.5 text-[12.5px]"
                  >
                    <RecipientAvatar
                      name={r.name}
                      index={colorIndex(state.recipients, r.id)}
                      size="xs"
                    />
                    <span className="truncate">{r.name || r.email || 'Unnamed'}</span>
                  </span>
                ))}
              </dd>
            </dl>
            <Field label="Title" hint="Also the email subject." error={problems.title}>
              {(props) => (
                <Input
                  {...props}
                  value={settings.title}
                  maxLength={TITLE_MAX}
                  className="text-[15px] font-semibold"
                  onChange={(e) => onSettings({ title: e.target.value })}
                />
              )}
            </Field>
            <Field
              label="Message (optional)"
              hint="A short note, for example what to check before signing."
              error={problems.message}
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  value={settings.message}
                  maxLength={MESSAGE_MAX}
                  placeholder="Hi, please review and sign the attached agreement."
                  onChange={(e) => onSettings({ message: e.target.value })}
                />
              )}
            </Field>
            {settings.changeNote !== undefined ? (
              <Field
                label="Note to recipients about what changed (optional)"
                hint="Shown as “What changed: …” in the invitation and above the document."
                error={problems.changeNote}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={settings.changeNote ?? ''}
                    maxLength={CHANGE_NOTE_MAX}
                    onChange={(e) => onSettings({ changeNote: e.target.value })}
                    placeholder="For example: the notice period is now 30 days, as you asked."
                  />
                )}
              </Field>
            ) : null}
            <div
              aria-hidden
              className="rounded-xl border border-dashed border-line-strong bg-canvas/60 p-4 text-center"
            >
              <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">
                Preview
              </p>
              <p className="mt-1 truncate font-display text-[17px] font-bold text-ink">
                {settings.title || 'Untitled'}
              </p>
              {settings.message ? (
                <p className="mx-auto mt-1 line-clamp-3 max-w-md text-[13.5px] whitespace-pre-line text-muted">
                  {settings.message}
                </p>
              ) : null}
              <span className="mt-3 inline-flex h-10 items-center rounded-full bg-primary px-5 font-display text-sm font-semibold text-primary-ink">
                Review and sign
              </span>
            </div>
          </div>
        </Panel>

        <Panel
          icon={<AlarmClock className="h-[18px] w-[18px]" />}
          title="Expiry and reminders"
          description="We chase the people who have not acted, so you do not have to."
        >
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <Field
              label="Expires after"
              hint="Links stop working after this."
              error={problems.expiresInDays}
            >
              {(props) => (
                <NativeSelect
                  {...props}
                  value={settings.expiresInDays}
                  onChange={(e) => onSettings({ expiresInDays: Number(e.target.value) })}
                >
                  {expiryOptions.map((days) => (
                    <option key={days} value={days}>
                      {days} days
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Automatic reminders" hint="Sent until they act, up to 5 times.">
              {(props) => (
                <NativeSelect
                  {...props}
                  value={settings.remindEveryDays}
                  onChange={(e) => onSettings({ remindEveryDays: Number(e.target.value) })}
                >
                  {REMINDER_OPTIONS.map((o) => (
                    <option key={o.days} value={o.days}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
        </Panel>
      </div>

      <aside className="space-y-6 lg:col-span-5" aria-label="Summary">
        <Panel icon={<FileText className="h-[18px] w-[18px]" />} title="Summary">
          <div className="space-y-5 px-5 py-5 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [state.documents.length, state.documents.length === 1 ? 'document' : 'documents'],
                [pages, pages === 1 ? 'page' : 'pages'],
                [state.fields.length, state.fields.length === 1 ? 'field' : 'fields'],
              ].map(([n, label]) => (
                <div key={String(label)} className="rounded-xl bg-surface-2 px-2 py-3">
                  <p className="font-display text-[22px] leading-none font-bold text-ink">{n}</p>
                  <p className="mt-1 text-[12px] text-muted">{label}</p>
                </div>
              ))}
            </div>
            <ul className="space-y-1.5">
              {state.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-ink">
                  <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {d.pages.length} {d.pages.length === 1 ? 'page' : 'pages'}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-2 flex items-center gap-2 font-semibold text-ink">
                <Users aria-hidden className="h-4 w-4 text-muted" />
                {state.routing === 'sequential' ? 'In this order' : 'All at once'}
              </p>
              <ol className="space-y-2">
                {state.recipients.map((r, i) => {
                  const own = state.fields.filter((f) => f.recipientId === r.id);
                  const required = own.filter((f) => f.required).length;
                  const signs = own.some(
                    (f) => f.type === (r.auth === 'aadhaar' ? 'aadhaar' : 'signature'),
                  );
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
                    >
                      {state.routing === 'sequential' ? (
                        <span className="w-4 shrink-0 text-center font-mono text-[11px] font-semibold text-muted">
                          {i + 1}
                        </span>
                      ) : null}
                      <RecipientAvatar name={r.name} index={colorIndex(state.recipients, r.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">
                          {r.name || 'Unnamed'}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {ROLE_LABEL[r.role]}
                          {r.role !== 'viewer' ? ` · ${AUTH_LABELS[r.auth]}` : ''}
                          {r.role === 'signer' ? ` · ${required} required` : ''}
                        </span>
                      </span>
                      {r.role === 'signer' ? (
                        signs ? (
                          <PenLine
                            aria-label={
                              r.auth === 'aadhaar'
                                ? 'Has the Aadhaar eSign box'
                                : 'Has a signature field'
                            }
                            className="h-4 w-4 shrink-0 text-success"
                          />
                        ) : (
                          <button
                            type="button"
                            className="shrink-0 text-[12.5px] font-semibold text-danger underline"
                            onClick={() => onGoTo('fields')}
                          >
                            {r.auth === 'aadhaar' ? 'No Aadhaar eSign box' : 'No signature'}
                          </button>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </Panel>
        <div className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent-soft/60 px-4 py-3 text-[13px] text-ink">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p>
            When everyone has signed, the PDF is sealed against changes and a certificate with the
            full audit trail is added.{' '}
            {actors.length > 1 ? 'Everyone on the envelope' : 'The recipient'} gets a link to the
            signed copy.
          </p>
        </div>
        <p className="flex items-center gap-2 px-1 text-[12.5px] text-muted">
          <BellRing aria-hidden className="h-3.5 w-3.5" />
          After sending, the envelope page shows live who has viewed and signed.
        </p>
      </aside>
    </div>
  );
}
