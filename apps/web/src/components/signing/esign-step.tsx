'use client';

import { CloudOff, Fingerprint, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { signFetch, type EsignStatus } from '@/lib/signing';
import { SigningMessage } from './signing-shell';

export interface EsignPoll {
  every: number;
  /** Stop asking after this long; the page then offers to look again. */
  giveUpAfter: number;
}

export const DEFAULT_ESIGN_POLL: EsignPoll = { every: 3_000, giveUpAfter: 10 * 60_000 };

const ENDED: Record<'expired' | 'failed', { title: string; body: string }> = {
  expired: {
    title: 'The Aadhaar eSign ran out of time',
    body: 'Nothing was signed. You can start again; your answers are still on the document.',
  },
  failed: {
    title: 'The Aadhaar eSign did not go through',
    body: 'Nothing was signed. This can happen when the one-time code is wrong or the name does not match. You can start again.',
  },
};

/**
 * Where the signer waits after the eSign provider sends them back: asks the server until the
 * signature is recorded, and says what to do when it was not.
 */
export function EsignWaitStep({
  poll = DEFAULT_ESIGN_POLL,
  onSigned,
  onDeclined,
  onRetry,
}: {
  poll?: EsignPoll;
  onSigned: () => void;
  onDeclined: () => void;
  onRetry: () => void;
}) {
  const [status, setStatus] = useState<EsignStatus | null>(null);
  const [lost, setLost] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    async function check() {
      try {
        const next = await signFetch<EsignStatus>('link/esign');
        if (stopped) return;
        setLost(false);
        setStatus(next);
        if (next.status === 'signed') return onSigned();
        if (next.status === 'declined') return onDeclined();
        if (next.status !== 'pending') return;
        if (Date.now() - started > poll.giveUpAfter) return setLost(true);
        timer = setTimeout(check, poll.every);
      } catch {
        if (!stopped) setLost(true);
      }
    }
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // The callbacks are stable for the life of the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, poll.every, poll.giveUpAfter]);

  if (status && (status.status === 'expired' || status.status === 'failed')) {
    const copy = ENDED[status.status];
    return (
      <SigningMessage
        icon={<CloudOff aria-hidden className="h-6 w-6" />}
        title={copy.title}
        tone="warning"
      >
        <p>{copy.body}</p>
        <Button type="button" onClick={onRetry} data-testid="esign-retry">
          Try again
        </Button>
      </SigningMessage>
    );
  }
  if (status?.status === 'none') {
    return (
      <SigningMessage
        icon={<Fingerprint aria-hidden className="h-6 w-6" />}
        title="Your Aadhaar eSign has not started"
      >
        <p>Go back to the document to fill it in and start the Aadhaar eSign.</p>
        <Button type="button" onClick={onRetry}>
          Open the document
        </Button>
      </SigningMessage>
    );
  }
  return (
    <SigningMessage
      icon={<Loader2 aria-hidden className="h-6 w-6 animate-spin motion-reduce:animate-none" />}
      title="Checking your Aadhaar eSign"
    >
      <p role="status" data-testid="esign-waiting">
        {lost
          ? 'We have not heard back from the eSign provider yet.'
          : 'This usually takes a few seconds. Keep this page open.'}
      </p>
      {lost ? (
        <Button type="button" onClick={() => setRound((n) => n + 1)}>
          Check again
        </Button>
      ) : null}
      {status?.signUrl ? (
        <p className="text-sm">
          Not finished there yet?{' '}
          <a className="font-semibold text-primary hover:underline" href={status.signUrl}>
            Go back to the Aadhaar eSign page
          </a>
        </p>
      ) : null}
    </SigningMessage>
  );
}
