'use client';

import type { Field, Recipient } from '@codevibe_technology/sign-core';
import { FieldPlacer, type ViewerDocument } from '@codevibe_technology/sign-react';
import { CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { usePdfjs } from '@/components/pdf/use-pdfjs';
import { Skeleton } from '@/components/ui/skeleton';
import type { DraftDocument, DraftRecipient, Problems } from '@/lib/send-flow';

const asRecipient = (r: DraftRecipient, i: number): Recipient => ({
  id: r.id,
  name: r.name.trim() || `Recipient ${i + 1}`,
  email: r.email,
  role: r.role,
  order: i + 1,
  auth: r.auth,
  status: 'pending',
});

/** Step 3: drop signature, date and other fields on the pages, in each recipient's colour. */
export function StepFields({
  documents,
  documentUrl,
  recipients,
  fields,
  problems,
  onChange,
}: {
  documents: DraftDocument[];
  documentUrl: (documentId: string) => string;
  recipients: DraftRecipient[];
  fields: Field[];
  problems: Problems;
  onChange: (fields: Field[]) => void;
}) {
  const pdf = usePdfjs();
  const viewerDocuments = useMemo<ViewerDocument[]>(
    () => documents.map((d) => ({ id: d.id, name: d.name, file: d.bytes ?? documentUrl(d.id) })),
    [documents, documentUrl],
  );
  const people = useMemo(() => recipients.map(asRecipient), [recipients]);

  const alerts = Object.entries(problems).filter(([key]) => key.startsWith('fields.'));

  return (
    <div className="space-y-3">
      {alerts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {alerts.map(([key, message]) => (
            <p
              key={key}
              role="alert"
              className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              <CircleAlert aria-hidden className="h-4 w-4 shrink-0" />
              {message}
            </p>
          ))}
        </div>
      ) : null}
      <div className="cvs-app overflow-hidden rounded-xl border border-line bg-surface shadow-card md:h-[calc(100dvh-18rem)] md:min-h-[520px]">
        {pdf ? (
          <FieldPlacer
            documents={viewerDocuments}
            recipients={people}
            fields={fields}
            onChange={onChange}
            pdf={pdf}
            fieldTypes={['signature', 'initials', 'date_signed', 'name', 'text', 'checkbox']}
          />
        ) : (
          <div role="status" aria-label="Loading the pages" className="space-y-3 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="mx-auto h-96 w-full max-w-xl" />
          </div>
        )}
      </div>
    </div>
  );
}
