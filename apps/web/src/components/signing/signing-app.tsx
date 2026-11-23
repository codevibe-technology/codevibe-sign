'use client';

import '@codevibe_technology/sign-react/styles.css';
import type { FieldValue } from '@codevibe_technology/sign-core';
import { CloudOff, Fingerprint } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SigningError,
  signFetch,
  type EndState,
  type EsignStart,
  type EsignStatus,
  type SignerView,
  type SigningBrand,
  type SigningReceipt,
} from '@/lib/signing';
import { ConsentStep } from './consent-step';
import { DoneStep, type PollDelays } from './done-step';
import { EndStateMessage } from './end-state';
import { EsignWaitStep, type EsignPoll } from './esign-step';
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
  | { kind: 'esign_wait' }
  | { kind: 'esign_off' }
  | { kind: 'esign_resume'; signUrl: string }
  | { kind: 'esign_closed' }
  | { kind: 'done'; name: string; approved: boolean };

async function loadBrand(workspaceId: string): Promise<SigningBrand | null> {
  try {
    const res = await fetch(`/brand/${encodeURIComponent(workspaceId)}/signing`);
    return res.ok ? ((await res.json()) as SigningBrand) : null;
  } catch {
    return null;
  }
}

/** The eSign provider sends the signer back to `/sign?esign=return`. */
const returnedFromEsign = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('esign') === 'return';

/** The phase a fresh signer view leads to. */
function phaseFor(view: SignerView): Phase {
  if (!view.canAct) return { kind: 'ended', state: 'not_your_turn' };
  if (view.otpRequired && !view.authenticated) return { kind: 'otp' };
  if (view.esign?.status === 'pending' || (view.esign && returnedFromEsign())) {
    return { kind: 'esign_wait' };
  }
  if (view.esign && !view.esign.available) return { kind: 'esign_off' };
  return { kind: 'consent' };
}

/**
 * The signing page. The link has put the token in an HttpOnly cookie, so everything here goes
 * through `/api/v1/sign/link`; once the signer has acted, the receipt the server hands back
 * lets the page follow the envelope to the signed copy.
 */
export function SigningApp({
  smsAvailable,
  poll,
  esignPoll,
  navigate = (url) => window.location.assign(url),
}: {
  smsAvailable: boolean;
  poll?: PollDelays;
  esignPoll?: EsignPoll;
  /** Leaves for the eSign provider's page; replaced in tests. */
  navigate?: (url: string) => void;
}) {
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
        // An Aadhaar eSign is recorded while the signer is away at the provider, so the link
        // is spent when they come back; the eSign status hands over the receipt.
        try {
          const esign = await signFetch<EsignStatus>('link/esign');
          setPhase(
            esign.status === 'signed'
              ? { kind: 'done', name: '', approved: false }
              : { kind: 'ended', state: 'invalid' },
          );
        } catch {
          // Back from the provider to a request that is closed: declined there, or withdrawn.
          setPhase(
            returnedFromEsign() ? { kind: 'esign_closed' } : { kind: 'ended', state: 'invalid' },
          );
        }
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

  /** Hands the filled-in document to the eSign provider and sends the signer to its page. */
  async function startEsign(values: FieldValue[]) {
    const started = await signFetch<EsignStart>('link/esign', {
      method: 'POST',
      body: JSON.stringify({ consent: true, values }),
    }).catch((err: unknown) => {
      if (err instanceof SigningError && err.code === 'ESIGN_UNAVAILABLE') {
        setPhase({ kind: 'esign_off' });
        return null;
      }
      throw err;
    });
    if (!started) return;
    // The earlier request holds what was filled in then, so the signer chooses to go on.
    if (started.resumed) setPhase({ kind: 'esign_resume', signUrl: started.signUrl });
    else navigate(started.signUrl);
  }

  function leaveEsignReturn() {
    if (returnedFromEsign()) window.history.replaceState(null, '', window.location.pathname);
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
      content = view && (
        <SignStep
          view={view}
          onSubmit={view.recipient.auth === 'aadhaar' ? startEsign : submit}
          onDecline={decline}
        />
      );
      break;
    case 'esign_wait':
      content = (
        <EsignWaitStep
          {...(esignPoll ? { poll: esignPoll } : {})}
          onSigned={() => {
            leaveEsignReturn();
            setPhase({ kind: 'done', name: view?.recipient.name ?? '', approved: false });
          }}
          onDeclined={() => {
            leaveEsignReturn();
            setPhase({ kind: 'ended', state: 'declined_by_you' });
          }}
          onRetry={() => {
            leaveEsignReturn();
            setPhase(
              view?.esign && !view.esign.available ? { kind: 'esign_off' } : { kind: 'consent' },
            );
          }}
        />
      );
      break;
    case 'esign_closed':
      content = (
        <SigningMessage
          icon={<Fingerprint aria-hidden className="h-6 w-6" />}
          title="This document was not signed"
          tone="warning"
        >
          <p data-testid="esign-closed">
            The Aadhaar eSign was declined or the request was closed, so nothing was signed. The
            sender has been told. You can close this page.
          </p>
        </SigningMessage>
      );
      break;
    case 'esign_resume':
      content = (
        <SigningMessage
          icon={<Fingerprint aria-hidden className="h-6 w-6" />}
          title="Finish the Aadhaar eSign you already started"
          tone="warning"
        >
          <p data-testid="esign-resume">
            An Aadhaar eSign for this document is already open, and a new one cannot be started
            right now. It has the details you filled in when you started it; anything you changed
            since is not included.
          </p>
          <Button type="button" onClick={() => navigate(phase.signUrl)}>
            Continue the eSign already started
          </Button>
        </SigningMessage>
      );
      break;
    case 'esign_off':
      content = (
        <SigningMessage
          icon={<Fingerprint aria-hidden className="h-6 w-6" />}
          title="Aadhaar eSign is not available right now"
          tone="warning"
        >
          <p data-testid="esign-off">
            This document is to be signed with Aadhaar eSign, which {company} cannot start at the
            moment. They have been told. You do not need to do anything; try this link again later.
          </p>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </SigningMessage>
      );
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
