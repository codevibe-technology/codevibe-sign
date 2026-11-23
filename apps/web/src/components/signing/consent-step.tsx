'use client';

import { LocalTime } from '@/components/ui/local-time';
import { CalendarClock, FileText, Fingerprint, MailCheck, PenLine, Quote } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { esignProviderName } from '@/lib/envelopes';
import type { SignerView } from '@/lib/signing';

export const CONSENT_TEXT =
  'I agree to do business electronically: to receive this document, and to sign it, by ' +
  'electronic means. I understand that my electronic signature is as legally binding as a ' +
  'handwritten one, and that I can ask the sender for a paper copy.';

/** What is being asked, and the signer's explicit agreement to sign electronically. */
export function ConsentStep({
  view,
  company,
  onContinue,
}: {
  view: SignerView;
  company: string;
  onContinue: () => Promise<void>;
}) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();
  const approver = view.recipient.role === 'approver';
  const verb = approver ? 'approve' : 'sign';
  const own = view.fields.filter(
    (f) => f.recipientId === view.recipient.id && f.type !== 'aadhaar',
  );
  const count = own.length;
  const aadhaar = view.recipient.auth === 'aadhaar';
  const pages = view.documents.reduce((n, d) => n + d.pageCount, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agreed) {
      setError('Tick the box to agree before you continue.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setPending(false);
    }
  }

  const steps = [
    {
      icon: FileText,
      text: `Read the document${pages > 1 ? ` (${pages} pages)` : ''}`,
    },
    {
      icon: PenLine,
      text: approver
        ? 'Approve it, or decline and say why'
        : aadhaar && count === 0
          ? `Nothing to fill in: ${esignProviderName(view.esign?.provider ?? 'leegality')} places your signature`
          : count === 1
            ? 'Fill in the 1 highlighted field and sign'
            : `Fill in the ${count} highlighted fields and sign`,
    },
    aadhaar
      ? {
          icon: Fingerprint,
          text: `Confirm with an Aadhaar one-time code on ${esignProviderName(view.esign?.provider ?? 'leegality')}`,
        }
      : { icon: MailCheck, text: 'Get the signed copy by email once everyone has signed' },
  ];

  return (
    <section className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(13_27_42/0.06),0_18px_40px_-18px_rgb(13_27_42/0.25)]">
      <div className="px-6 pt-7 pb-6 sm:px-9 sm:pt-9">
        <p className="eyebrow">Hello {view.recipient.name}</p>
        <h1
          className="mt-2 text-[24px] leading-tight font-bold outline-none sm:text-[28px]"
          tabIndex={-1}
          data-autofocus
        >
          {company} asks you to {verb} &ldquo;{view.envelope.title}&rdquo;
        </h1>
        {view.envelope.changeNote ? (
          <p
            className="mt-4 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm whitespace-pre-line text-ink"
            data-testid="change-note"
          >
            <span className="font-semibold">What changed:</span> {view.envelope.changeNote}
          </p>
        ) : null}
        {view.envelope.message ? (
          <figure className="mt-5 rounded-xl bg-surface-2 px-4 py-3.5">
            <figcaption className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">
              <Quote aria-hidden className="h-3.5 w-3.5" />
              Message from {company}
            </figcaption>
            <blockquote className="text-[15px] whitespace-pre-line text-ink">
              {view.envelope.message}
            </blockquote>
          </figure>
        ) : null}
        <ul className="mt-5 space-y-2" aria-label="Documents">
          {view.documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-sm"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <FileText aria-hidden className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{d.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted">
                {d.pageCount} {d.pageCount === 1 ? 'page' : 'pages'}
              </span>
            </li>
          ))}
        </ul>
        {view.envelope.expiresAt ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <CalendarClock aria-hidden className="h-4 w-4 shrink-0" />
            <span>
              Please {verb} by <LocalTime iso={view.envelope.expiresAt} />.
            </span>
          </p>
        ) : null}

        <ol className="mt-6 grid gap-2 sm:grid-cols-3" aria-label="What happens next">
          {steps.map(({ icon: Icon, text }, i) => (
            <li key={text} className="flex gap-3 rounded-xl bg-canvas px-3 py-3 sm:flex-col">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-primary shadow-[0_1px_2px_rgb(13_27_42/0.08)]">
                <Icon aria-hidden className="h-4 w-4" />
              </span>
              <span className="text-[13px] leading-snug text-ink">
                <span className="sr-only">Step {i + 1}: </span>
                {text}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <form
        onSubmit={submit}
        noValidate
        className="space-y-4 border-t border-line bg-surface-2/60 px-6 py-6 sm:px-9"
      >
        <div className="flex items-start gap-3">
          <input
            id={id}
            type="checkbox"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-primary"
          />
          <label htmlFor={id} className="cursor-pointer text-[13.5px] leading-6 text-ink">
            {CONSENT_TEXT}
          </label>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          pending={pending}
          pill
          className="h-12 w-full text-base shadow-[0_10px_22px_-10px_var(--primary)]"
        >
          Continue to the document
        </Button>
      </form>
    </section>
  );
}
