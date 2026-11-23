'use client';

import { LocalTime } from '@/components/ui/local-time';
import { FileText } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
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
  const verb = view.recipient.role === 'approver' ? 'approve' : 'sign';

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

  return (
    <section className="mx-auto max-w-lg rounded-xl border border-line border-t-[3px] border-t-accent bg-surface p-6 shadow-card sm:p-8">
      <p className="eyebrow">Hello {view.recipient.name}</p>
      <h1 className="mt-2 text-[22px] leading-tight font-bold" tabIndex={-1} data-autofocus>
        {company} asks you to {verb} &ldquo;{view.envelope.title}&rdquo;
      </h1>
      {view.envelope.changeNote ? (
        <p
          className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-sm whitespace-pre-line text-ink"
          data-testid="change-note"
        >
          <span className="font-semibold">What changed:</span> {view.envelope.changeNote}
        </p>
      ) : null}
      {view.envelope.message ? (
        <blockquote className="mt-4 border-l-[3px] border-accent pl-3 whitespace-pre-line">
          {view.envelope.message}
        </blockquote>
      ) : null}
      <ul
        className="mt-5 divide-y divide-line rounded-lg border border-line"
        aria-label="Documents"
      >
        {view.documents.map((d) => (
          <li key={d.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
            <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted" />
            <span className="truncate font-medium">{d.name}</span>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
              {d.pageCount} {d.pageCount === 1 ? 'page' : 'pages'}
            </span>
          </li>
        ))}
      </ul>
      {view.envelope.expiresAt ? (
        <p className="mt-3 text-sm text-muted">
          Please {verb} by <LocalTime iso={view.envelope.expiresAt} />.
        </p>
      ) : null}
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3">
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
            className="mt-1 h-5 w-5 shrink-0 accent-primary"
          />
          <label htmlFor={id} className="text-sm leading-6">
            {CONSENT_TEXT}
          </label>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" pending={pending} className="h-12 w-full text-base">
          Continue to the document
        </Button>
      </form>
    </section>
  );
}
