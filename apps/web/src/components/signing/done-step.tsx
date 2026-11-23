'use client';

import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { receiptDocumentUrl, signFetch, type SigningReceipt } from '@/lib/signing';
import { SigningMessage } from './signing-shell';

export interface PollDelays {
  /** While the seal is being applied. */
  sealing: number;
  /** While others still have to sign. */
  waiting: number;
  /** Stop asking after this long; the email still arrives. */
  giveUpAfter: number;
}

export const DEFAULT_POLL: PollDelays = {
  sealing: 3_000,
  waiting: 15_000,
  giveUpAfter: 10 * 60_000,
};

const STOPPED = new Set(['declined', 'voided', 'expired']);

/** Thanks the signer, says what happens next, and offers the signed copy once it is sealed. */
export function DoneStep({
  name,
  company,
  approved,
  poll = DEFAULT_POLL,
}: {
  name: string;
  company: string;
  approved: boolean;
  poll?: PollDelays;
}) {
  const [receipt, setReceipt] = useState<SigningReceipt | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    async function check() {
      try {
        const next = await signFetch<SigningReceipt>('receipt');
        if (stopped) return;
        setReceipt(next);
        const status = next.envelope.status;
        const ready = status === 'completed' && next.documents.every((d) => d.sealed);
        if (ready || STOPPED.has(status) || Date.now() - started > poll.giveUpAfter) return;
        timer = setTimeout(check, status === 'completed' ? poll.sealing : poll.waiting);
      } catch {
        if (!stopped) setLost(true);
      }
    }
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [poll]);

  const status = receipt?.envelope.status;
  const ready = status === 'completed' && receipt?.documents.every((d) => d.sealed);
  const known = name || receipt?.recipient.name || '';
  const firstName = known.split(/\s+/)[0] || known;

  return (
    <SigningMessage
      icon={<CheckCircle2 aria-hidden className="h-6 w-6" />}
      title={firstName ? `Thank you, ${firstName}` : 'Thank you'}
      tone="success"
    >
      <p>
        You {approved ? 'approved' : 'signed'}
        {receipt ? ` “${receipt.envelope.title}”` : ' the document'}. A record of it is kept with
        the document.
      </p>
      <div role="status" aria-live="polite" className="space-y-3">
        {ready && receipt ? (
          <>
            <p>Everyone has signed. Your copy is ready.</p>
            <ul className="space-y-2">
              {receipt.documents.map((d) => (
                <li key={d.id}>
                  <Button asChild className="w-full">
                    <a href={receiptDocumentUrl(d.id)} download>
                      <Download aria-hidden className="h-4 w-4" />
                      {receipt.documents.length === 1 ? 'Download your copy' : `Download ${d.name}`}
                    </a>
                  </Button>
                  {d.certificate ? (
                    <a
                      href={`${receiptDocumentUrl(d.id)}?file=certificate`}
                      download
                      className="mt-2 inline-block text-sm font-semibold text-primary hover:underline"
                    >
                      Download the signing certificate
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            {receipt.documents[0] ? (
              <a
                href={`${receiptDocumentUrl(receipt.documents[0].id)}?file=audit-trail`}
                download
                className="inline-block text-sm font-semibold text-primary hover:underline"
                data-testid="audit-trail-download"
              >
                Download the audit trail (PDF)
              </a>
            ) : null}
            <p className="text-sm">We have emailed it to you as well.</p>
          </>
        ) : status === 'completed' ? (
          <p className="inline-flex items-center gap-2">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Everyone has signed. We are
            sealing your copy; it will be ready in a moment.
          </p>
        ) : status && STOPPED.has(status) ? (
          <p>
            The request was {status === 'expired' ? 'not completed in time' : status}, so it will
            not be completed. {company} has been told.
          </p>
        ) : receipt ? (
          <p>
            {receipt.waitingFor === 1
              ? 'One more person needs to sign.'
              : `${receipt.waitingFor} more people need to sign.`}{' '}
            When everyone has, we will email you the signed copy. You can close this page.
          </p>
        ) : lost ? (
          <p>
            When everyone has signed, we will email you the signed copy. You can close this page.
          </p>
        ) : null}
      </div>
    </SigningMessage>
  );
}
