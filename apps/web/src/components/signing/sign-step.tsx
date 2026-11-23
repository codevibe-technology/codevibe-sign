'use client';

import type { FieldValue } from '@codevibe_technology/sign-core';
import { SigningView, type SigningViewLabels } from '@codevibe_technology/sign-react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { usePdfjs } from '@/components/pdf/use-pdfjs';
import { Skeleton } from '@/components/ui/skeleton';
import { esignProviderName } from '@/lib/envelopes';
import { zoneLabel } from '@/lib/preferences';
import { linkDocumentUrl, signingDay, type SignerView } from '@/lib/signing';

/**
 * The documents with the signer's own fields. A guide button takes the signer from Start
 * through each field to Finish, with a count of what is left.
 */
export function SignStep({
  view,
  onSubmit,
  onDecline,
}: {
  view: SignerView;
  onSubmit: (values: FieldValue[]) => Promise<void>;
  onDecline: (reason: string) => Promise<void>;
}) {
  const pdf = usePdfjs();
  const documents = useMemo(
    () => view.documents.map((d) => ({ id: d.id, name: d.name, file: linkDocumentUrl(d.id) })),
    [view.documents],
  );
  const approver = view.recipient.role === 'approver';
  const aadhaar = view.recipient.auth === 'aadhaar';
  const provider = esignProviderName(view.esign?.provider ?? 'leegality');
  // The document gets the date of signing in the workspace's zone, whatever zone the signer
  // is in, so the field shows that date rather than the browser's.
  const labels: Partial<SigningViewLabels> = {
    formatDate: () => signingDay(new Date(), view.timeZone),
    signatureTitle: 'Adopt your signature',
    initialsTitle: 'Adopt your initials',
    apply: 'Adopt and sign',
    progress: (done, total) => `${done} of ${total} required fields done`,
    ...(approver
      ? {
          finish: 'Approve',
          declineTitle: 'Decline to approve',
          confirmTitle: 'Approve this document?',
          confirmBody: () =>
            'When you approve, the sender is told and the next person, if any, gets their link. You cannot change it afterwards.',
          confirmFinish: 'Approve',
        }
      : aadhaar
        ? {
            finish: 'Continue to Aadhaar eSign',
            confirmTitle: 'Next: sign with Aadhaar eSign',
            confirmBody: () =>
              `You will go to ${provider}, a licensed eSign provider, and confirm with a one-time code sent to the mobile number linked to your Aadhaar. Codevibe Sign never sees your Aadhaar number. You come back here when it is done.`,
            confirmFinish: 'Continue to Aadhaar eSign',
          }
        : {
            finish: 'Finish and sign',
            confirmTitle: 'Ready to sign?',
            confirmFinish: 'Finish and sign',
          }),
  };
  const hasDate = view.fields.some((f) => f.type === 'date_signed');
  // The Aadhaar eSign box is signed at the provider, so it is not one of the fields to fill.
  const fieldCount = view.fields.filter((f) => f.type !== 'aadhaar').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
        <div className="min-w-0">
          <h1
            className="truncate text-[17px] leading-tight font-bold outline-none sm:text-[22px]"
            tabIndex={-1}
            data-autofocus
          >
            {view.envelope.title}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted sm:text-sm">
            {approver
              ? 'Read the document, then approve it or decline.'
              : aadhaar && fieldCount === 0
                ? 'Read the document. The highlighted box is where your Aadhaar eSign goes.'
                : fieldCount === 1
                  ? 'Press Start to go to the highlighted field, then finish.'
                  : `Press Start and we take you to each of the ${fieldCount} highlighted fields in turn.`}{' '}
            {hasDate ? (
              <span data-testid="signing-zone">
                The date of signing is recorded in {zoneLabel(view.timeZone)}.
              </span>
            ) : null}
          </p>
        </div>
        <p className="hidden items-center gap-3 text-[12.5px] text-muted md:flex">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-success" />
            Every step is recorded
          </span>
        </p>
      </div>
      {aadhaar ? (
        <p
          className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary-soft px-3.5 py-2.5 text-[13px] text-ink"
          data-testid="esign-note"
        >
          <Fingerprint aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            <span className="font-semibold">This document is signed with Aadhaar eSign.</span> When
            you continue, you confirm with a one-time code from Aadhaar on the page of {provider}, a
            licensed eSign provider. Codevibe Sign never sees your Aadhaar number.
          </span>
        </p>
      ) : null}
      {view.envelope.changeNote ? (
        <p
          className="max-h-24 overflow-y-auto rounded-xl bg-warning-soft px-3.5 py-2.5 text-sm whitespace-pre-line text-ink"
          data-testid="change-note"
        >
          <span className="font-semibold">What changed:</span> {view.envelope.changeNote}
        </p>
      ) : null}

      {/* The card fills the rest of the window: the pages scroll inside it and the Start,
          Next and Finish bar sits under them, always on screen. */}
      <div className="cvs-app flex min-h-0 flex-1 flex-col overflow-clip rounded-t-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(13_27_42/0.06),0_12px_32px_-16px_rgb(13_27_42/0.22)] sm:rounded-2xl">
        {pdf ? (
          <SigningView
            documents={documents}
            fields={view.fields}
            recipient={view.recipient}
            initialValues={view.values}
            onSubmit={onSubmit}
            onDecline={onDecline}
            pdf={pdf}
            labels={labels}
            confirmBeforeFinish
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading the document">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="aspect-[3/4] w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
