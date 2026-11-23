'use client';

import '@codevibe_technology/sign-react/styles.css';
import type { FieldValue } from '@codevibe_technology/sign-core';
import { CloudOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SigningError,
  signFetch,
  type EndState,
  type SignerView,
  type SigningBrand,
  type SigningReceipt,
} from '@/lib/signing';
import { ConsentStep } from './consent-step';
import { DoneStep, type PollDelays } from './done-step';
import { EndStateMessage } from './end-state';
import { OtpStep } from './otp-step';
import { SignStep } from './sign-step';
import { SigningMessage, SigningShell } from './signing-shell';

type Phase =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ended'; state: EndState }
  | { kind: 'otp' }
  | { kind: 'consent' }
  | { kind: 'sign' }
  | { kind: 'done'; name: string; approved: boolean };

async function loadBrand(workspaceId: string): Promise<SigningBrand | null> {
  try {
    const res = await fetch(`/brand/${encodeURIComponent(workspaceId)}/signing`);
    return res.ok ? ((await res.json()) as SigningBrand) : null;
  } catch {
    return null;
  }
}

/** The phase a fresh signer view leads to. */
function phaseFor(view: SignerView): Phase {
  if (!view.canAct) return { kind: 'ended', state: 'not_your_turn' };
  if (view.otpRequired && !view.authenticated) return { kind: 'otp' };
  return { kind: 'consent' };
}

/**
 * The signing page. The link has put the token in an HttpOnly cookie, so everything here goes
 * through `/api/v1/sign/link`; once the signer has acted, the receipt the server hands back
 * lets the page follow the envelope to the signed copy.
 */
export function SigningApp({ smsAvailable, poll }: { smsAvailable: boolean; poll?: PollDelays }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [view, setView] = useState<SignerView | null>(null);
  const [brand, setBrand] = useState<SigningBrand | null>(null);
  const main = useRef<HTMLDivElement>(null);
  const company = brand?.name ?? 'the sender';

  const fail = useCallback((err: unknown) => {
    if (err instanceof SigningError && err.code === 'TOKEN_INVALID') {
      setPhase({ kind: 'ended', state: 'invalid' });
    } else {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'Something went wrong. Try again.',
      });
    }
  }, []);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const next = await signFetch<SignerView>('link');
      setView(next);
      setBrand(await loadBrand(next.workspaceId));
      setPhase(phaseFor(next));
    } catch (err) {
      if (!(err instanceof SigningError) || err.code !== 'TOKEN_INVALID') return fail(err);
      // Signed earlier in this browser: the link is spent but the receipt still works.
      try {
        const receipt = await signFetch<SigningReceipt>('receipt');
        setBrand(await loadBrand(receipt.workspaceId));
        setPhase({
          kind: 'done',
          name: receipt.recipient.name,
          approved: receipt.recipient.status === 'approved',
        });
      } catch {
        setPhase({ kind: 'ended', state: 'invalid' });
      }
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  // Each new step starts at its heading, for keyboard and screen reader users.
  useEffect(() => {
    if (phase.kind === 'loading') return;
    main.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [phase.kind]);

  async function refreshAfterOtp() {
    try {
      const next = await signFetch<SignerView>('link');
      setView(next);
      setPhase(phaseFor(next));
    } catch (err) {
      fail(err);
    }
  }

  async function startSigning() {
    try {
      await signFetch('link/view', { method: 'POST' });
    } catch (err) {
      if (err instanceof SigningError && err.code === 'TOKEN_INVALID') {
        setPhase({ kind: 'ended', state: 'invalid' });
        return;
      }
      throw err;
    }
    setPhase({ kind: 'sign' });
  }

  /** Errors thrown here are shown by the signing view next to the Finish button. */
  async function submit(values: FieldValue[]) {
    if (!view) return;
    await signFetch('link/submit', {
      method: 'POST',
      body: JSON.stringify({ consent: true, values }),
    });
    setPhase({
      kind: 'done',
      name: view.recipient.name,
      approved: view.recipient.role === 'approver',
    });
  }

  async function decline(reason: string) {
    await signFetch('link/decline', { method: 'POST', body: JSON.stringify({ reason }) });
    setPhase({ kind: 'ended', state: 'declined_by_you' });
  }

  let content;
  switch (phase.kind) {
    case 'loading':
      content = (
        <div className="mx-auto max-w-lg space-y-3" aria-busy="true" aria-label="Opening">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
      break;
    case 'failed':
      content = (
        <SigningMessage
          icon={<CloudOff aria-hidden className="h-6 w-6" />}
          title="We could not open the document"
          tone="warning"
        >
          <p>{phase.message}</p>
          <Button type="button" onClick={() => void load()}>
            Try again
          </Button>
        </SigningMessage>
      );
      break;
    case 'ended':
      content = <EndStateMessage state={phase.state} company={brand?.name ?? null} />;
      break;
    case 'otp':
      content = view && (
        <OtpStep
          view={view}
          company={company}
          smsAvailable={smsAvailable}
          onVerified={refreshAfterOtp}
        />
      );
      break;
    case 'consent':
      content = view && <ConsentStep view={view} company={company} onContinue={startSigning} />;
      break;
    case 'sign':
      content = view && <SignStep view={view} onSubmit={submit} onDecline={decline} />;
      break;
    case 'done':
      content = (
        <DoneStep
          name={phase.name}
          company={company}
          approved={phase.approved}
          {...(poll ? { poll } : {})}
        />
      );
      break;
  }

  return (
    <SigningShell brand={brand} fill={phase.kind === 'sign'}>
      <div
        ref={main}
        className={phase.kind === 'sign' ? 'flex min-h-0 flex-1 flex-col' : undefined}
      >
        {content}
      </div>
    </SigningShell>
  );
}
