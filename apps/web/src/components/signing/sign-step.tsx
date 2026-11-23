'use client';

import type { FieldValue } from '@codevibe_technology/sign-core';
import { SigningView, type SigningViewLabels } from '@codevibe_technology/sign-react';
import { useMemo } from 'react';
import { usePdfjs } from '@/components/pdf/use-pdfjs';
import { Skeleton } from '@/components/ui/skeleton';
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
  // The document gets the date of signing in the workspace's zone, whatever zone the signer
  // is in, so the field shows that date rather than the browser's.
  const labels: Partial<SigningViewLabels> = {
    formatDate: () => signingDay(new Date(), view.timeZone),
    ...(approver
      ? { finish: 'Approve', declineTitle: 'Decline to approve' }
      : { finish: 'Finish and sign' }),
  };
  const hasDate = view.fields.some((f) => f.type === 'date_signed');
  const fieldCount = view.fields.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg leading-tight font-bold sm:text-[22px]" tabIndex={-1} data-autofocus>
          {view.envelope.title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {approver
            ? 'Read the document, then approve it or decline.'
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
      {view.envelope.changeNote ? (
        <p
          className="max-h-24 overflow-y-auto rounded-lg bg-warning-soft px-3 py-2 text-sm whitespace-pre-line text-ink"
          data-testid="change-note"
        >
          <span className="font-semibold">What changed:</span> {view.envelope.changeNote}
        </p>
      ) : null}

      {/* The card fills the rest of the window: the pages scroll inside it and the Start,
          Next and Finish bar sits under them, always on screen. */}
      <div className="cvs-app flex min-h-0 flex-1 flex-col overflow-clip rounded-xl border border-line bg-surface shadow-card">
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
