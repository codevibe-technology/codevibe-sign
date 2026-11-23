'use client';

import {
  EarlierSignatures,
  type EarlierSignatureRow,
} from '@/components/verify/earlier-signatures';
import { ExternalLink, FileText, ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { MAX_PDF_BYTES } from '@/lib/send-flow';
import { formatDateTime } from '@/lib/envelopes';
import { verifyDocumentAction } from '@/server/actions/envelopes';
import { FileDrop } from './file-drop';

interface Outcome {
  valid: boolean;
  summary: string;
  signer: string | null;
  signedAt: string | null;
  sha256: string;
  earlier?: EarlierSignatureRow[];
  fileName: string;
  envelope: { envelopeId: string; title: string; documentName: string } | null;
}

/** Drop a PDF and learn whether it is exactly what this workspace sealed. */
export function VerifyPanel({ workspaceId, slug }: { workspaceId: string; slug: string }) {
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  function check(file: File) {
    setOutcome(null);
    if (file.size > MAX_PDF_BYTES) {
      setError(
        `${file.name} is larger than 20 MB; sealed documents from this workspace are smaller.`,
      );
      return;
    }
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set('workspaceId', workspaceId);
      form.set('file', file);
      const result = await verifyDocumentAction(form);
      if (result.ok) setOutcome(result.data);
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <FileDrop
        onFiles={(files) => check(files[0]!)}
        title={pending ? 'Checking the seal…' : 'Drop a signed PDF here'}
        hint="The file is checked on the server against this workspace's seal certificate. Nothing is stored."
        disabled={pending}
      />
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      {outcome ? (
        <Card
          role="status"
          className={cn(
            'overflow-hidden',
            outcome.valid ? 'border-success/50' : 'border-danger/50',
          )}
        >
          <div
            className={cn(
              'flex items-start gap-4 px-5 py-5',
              outcome.valid ? 'bg-success-soft' : 'bg-danger-soft',
            )}
          >
            {outcome.valid ? (
              <ShieldCheck aria-hidden className="h-8 w-8 shrink-0 text-success" />
            ) : (
              <ShieldAlert aria-hidden className="h-8 w-8 shrink-0 text-danger" />
            )}
            <div className="min-w-0">
              <p
                className={cn(
                  'font-display text-lg font-bold',
                  outcome.valid ? 'text-success' : 'text-danger',
                )}
              >
                {outcome.valid ? 'Authentic' : 'Not verified'}
              </p>
              <p className="text-sm text-ink">{outcome.summary}</p>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 text-sm">
            <dt className="text-muted">File</dt>
            <dd className="flex min-w-0 items-center gap-1.5">
              <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted" />
              <span className="truncate">{outcome.fileName}</span>
            </dd>
            {outcome.signer ? (
              <>
                <dt className="text-muted">Sealed by</dt>
                <dd>{outcome.signer}</dd>
              </>
            ) : null}
            {outcome.signedAt ? (
              <>
                <dt className="text-muted">Sealed at</dt>
                <dd>{formatDateTime(outcome.signedAt)}</dd>
              </>
            ) : null}
            <EarlierSignatures signatures={outcome.earlier ?? []} />
            <dt className="text-muted">SHA-256</dt>
            <dd className="min-w-0">
              <code className="block truncate font-mono text-xs" title={outcome.sha256}>
                {outcome.sha256}
              </code>
            </dd>
          </dl>
          {outcome.envelope ? (
            <div className="border-t border-line px-5 py-3">
              <Button asChild size="sm" variant="secondary">
                <Link href={`/dashboard/${slug}/envelopes/${outcome.envelope.envelopeId}`}>
                  <ExternalLink aria-hidden className="h-4 w-4" />
                  Open “{outcome.envelope.title}”
                </Link>
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
