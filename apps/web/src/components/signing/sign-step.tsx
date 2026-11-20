'use client';

import type { FieldValue } from '@codevibe_technology/sign-core';
import { SigningView, type SigningViewLabels } from '@codevibe_technology/sign-react';
import { useMemo } from 'react';
import { usePdfjs } from '@/components/pdf/use-pdfjs';
import { Skeleton } from '@/components/ui/skeleton';
import { linkDocumentUrl, type SignerView } from '@/lib/signing';

/** The documents with the signer's own fields, a next-field button and a required counter. */
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
  const labels: Partial<SigningViewLabels> = approver
    ? { finish: 'Approve', declineTitle: 'Decline to approve' }
    : { finish: 'Finish and sign' };
  const fieldCount = view.fields.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold" tabIndex={-1} data-autofocus>
          {view.envelope.title}
        </h1>
        <p className="text-sm text-muted">
          {approver
            ? 'Read the document, then approve it or decline.'
            : fieldCount === 1
              ? 'Fill in the highlighted field, then finish.'
              : `Fill in the ${fieldCount} highlighted fields. "Next field" takes you to each one.`}
        </p>
      </div>
      {view.envelope.changeNote ? (
        <p
          className="rounded-lg bg-warning-soft px-3 py-2 text-sm whitespace-pre-line text-ink"
          data-testid="change-note"
        >
          <span className="font-semibold">What changed:</span> {view.envelope.changeNote}
        </p>
      ) : null}

      <div className="cvs-app overflow-hidden rounded-xl border border-line bg-surface">
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
