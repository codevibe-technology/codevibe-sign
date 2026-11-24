'use client';

import type { Field, Recipient } from '@codevibe_technology/sign-core';
import { FieldPlacer, type ViewerDocument } from '@codevibe_technology/sign-react';
import { CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { usePdfjs } from '@/components/pdf/use-pdfjs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { type DraftDocument, type DraftRecipient, type Problems } from '@/lib/send-flow';
import { AadhaarPlacementNote } from './aadhaar-note';

const PLACER_LABELS = {
  aadhaarHint: (name: string) =>
    `${name} signs with Aadhaar eSign and fills in nothing. Optionally place one Aadhaar seal position: it only marks where Leegality draws the Aadhaar signature. Without it, Leegality places it where your workflow says.`,
  aadhaarSummary: 'Aadhaar eSign: fills in nothing. Leegality draws the signature.',
  aadhaarPositionNote:
    'Position only. Leegality draws the Aadhaar signature here; nothing is added to the file.',
};

const asRecipient = (r: DraftRecipient, i: number): Recipient => ({
  id: r.id,
  name: r.name.trim() || `Recipient ${i + 1}`,
  email: r.email,
  role: r.role,
  order: i + 1,
  auth: r.auth,
  status: 'pending',
});

/**
 * Step 3: drop signature, date and other fields on the pages, in each recipient's colour. A
 * signer who uses Aadhaar eSign fills in nothing; they may get one Aadhaar seal position,
 * which only says where Leegality draws their signature.
 * `fill` takes all the room its parent gives it (the full-screen send flow); `card` sits in a
 * page as a bordered box (the template editor).
 */
export function StepFields({
  documents,
  documentUrl,
  recipients,
  fields,
  problems,
  onChange,
  layout = 'card',
  previewing,
  onPreviewingChange,
  sealPosition,
}: {
  documents: DraftDocument[];
  documentUrl: (documentId: string) => string;
  recipients: DraftRecipient[];
  fields: Field[];
  problems: Problems;
  onChange: (fields: Field[]) => void;
  layout?: 'card' | 'fill';
  previewing?: boolean;
  onPreviewingChange?: (previewing: boolean) => void;
  /** The Leegality account in use places the Aadhaar seal position; unknown when left out. */
  sealPosition?: boolean;
}) {
  const pdf = usePdfjs();
  const viewerDocuments = useMemo<ViewerDocument[]>(
    () => documents.map((d) => ({ id: d.id, name: d.name, file: d.bytes ?? documentUrl(d.id) })),
    [documents, documentUrl],
  );
  const people = useMemo(() => recipients.map(asRecipient), [recipients]);

  const alerts = Object.entries(problems).filter(([key]) => key.startsWith('fields.'));
  const fill = layout === 'fill';
  const esigner = recipients.find((r) => r.auth === 'aadhaar' && r.role === 'signer');
  const sealPlaced = Boolean(
    esigner && fields.some((f) => f.recipientId === esigner.id && f.type === 'aadhaar'),
  );

  return (
    <div className={cn('flex flex-col', fill ? 'md:h-full md:min-h-0' : 'gap-3')}>
      {alerts.length > 0 ? (
        <div
          className={cn(
            'flex flex-col gap-1.5',
            fill && 'border-b border-danger/30 bg-danger-soft px-4 py-2',
          )}
        >
          {alerts.map(([key, message]) => (
            <p
              key={key}
              role="alert"
              className={cn(
                'flex items-center gap-2 text-sm text-danger',
                !fill && 'rounded-md border border-danger/30 bg-danger-soft px-3 py-2',
              )}
            >
              <CircleAlert aria-hidden className="h-4 w-4 shrink-0" />
              {message}
            </p>
          ))}
        </div>
      ) : null}
      {esigner ? (
        <AadhaarPlacementNote
          name={esigner.name.trim() || undefined}
          placed={sealPlaced}
          {...(sealPosition !== undefined ? { supported: sealPosition } : {})}
          className={cn(fill ? 'rounded-none border-x-0 border-t-0 px-4 py-2' : '')}
        />
      ) : null}
      <div
        className={cn(
          'cvs-app bg-surface',
          fill
            ? 'md:min-h-0 md:flex-1 md:overflow-hidden'
            : 'overflow-hidden rounded-xl border border-line shadow-card md:h-[calc(100dvh-18rem)] md:min-h-[560px]',
        )}
      >
        {pdf ? (
          <FieldPlacer
            documents={viewerDocuments}
            recipients={people}
            fields={fields}
            onChange={onChange}
            pdf={pdf}
            labels={PLACER_LABELS}
            fieldTypes={[
              'signature',
              'initials',
              'date_signed',
              'name',
              'text',
              'checkbox',
              'aadhaar',
            ]}
            {...(previewing !== undefined ? { previewing } : {})}
            {...(onPreviewingChange ? { onPreviewingChange } : {})}
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
