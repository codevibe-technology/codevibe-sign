'use client';

import type { Field, Recipient } from '@codevibe_technology/sign-core';
import {
  FieldPlacer,
  type LoadPdfOptions,
  type PdfjsModule,
  type ViewerDocument,
} from '@codevibe_technology/sign-react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { DraftDocument, DraftRecipient, Problems } from '@/lib/send-flow';
import { RecipientDot, colorIndex } from './step-recipients';

/** pdf.js and its worker, loaded in the browser on first use. */
function usePdfjs(): LoadPdfOptions | null {
  const [options, setOptions] = useState<LoadPdfOptions | null>(null);
  useEffect(() => {
    let live = true;
    void import('pdfjs-dist').then((pdfjs) => {
      if (!live) return;
      setOptions({
        pdfjs: pdfjs as unknown as PdfjsModule,
        workerSrc: new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString(),
      });
    });
    return () => {
      live = false;
    };
  }, []);
  return options;
}

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
  const actors = recipients.filter((r) => r.role !== 'viewer');

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm text-muted">
          Pick a person, then drag a field onto the page (or press Enter on it). Every signer needs
          at least one signature. Approvers need no fields.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2" aria-label="Fields per recipient">
          {actors.map((r) => {
            const count = fields.filter((f) => f.recipientId === r.id).length;
            const problem = problems[`fields.${r.id}`];
            return (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <RecipientDot index={colorIndex(recipients, r.id)} />
                <span className="font-semibold">{r.name || 'Unnamed'}</span>
                <span className="text-muted">
                  {count} {count === 1 ? 'field' : 'fields'}
                </span>
                {r.role === 'signer' ? (
                  problem ? (
                    <CircleAlert
                      aria-label="Needs a signature field"
                      className="h-4 w-4 text-warning"
                    />
                  ) : (
                    <CheckCircle2 aria-label="Ready" className="h-4 w-4 text-success" />
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
        {Object.entries(problems)
          .filter(([key]) => key.startsWith('fields.'))
          .map(([key, message]) => (
            <p key={key} role="alert" className="mt-2 text-sm text-danger">
              {message}
            </p>
          ))}
      </Card>
      <div className="cvs-app overflow-hidden rounded-xl border border-line bg-surface shadow-card">
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
