import { isFinal, type Envelope } from '@codevibe_technology/sign-core';
import type { Runtime } from '../runtime/context';
import type { EsignOutcome, EsignSession, EsignSessionPatch, EsignSessionStatus } from './types';

export const OPEN_STATUSES: readonly EsignSessionStatus[] = ['starting', 'pending'];

/**
 * Tells `onEnd` how a session ended and clears the note that it still has to. A failure
 * leaves the note in place, so `tick()` tries again.
 */
export async function settle(
  rt: Runtime,
  session: EsignSession,
  outcome: EsignOutcome,
): Promise<void> {
  const store = rt.store.esign;
  if (!store) return;
  try {
    await rt.esign?.onEnd?.({
      workspaceId: session.workspaceId,
      envelopeId: session.envelopeId,
      recipientId: session.recipientId,
      ref: session.id,
      outcome,
    });
    await store.settle(session.id);
  } catch (err) {
    rt.logger.error('esign onEnd failed, will retry', {
      envelope: session.envelopeId,
      session: session.id,
      outcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Ends a session if it is still in one of `from`, and tells `onEnd` when it did. The
 * compare-and-set is what makes a repeated webhook, or a webhook racing a poll, act once.
 */
export async function endSession(
  rt: Runtime,
  session: EsignSession,
  from: readonly EsignSessionStatus[],
  outcome: EsignOutcome,
  patch: EsignSessionPatch = {},
): Promise<boolean> {
  const store = rt.store.esign;
  if (!store) return false;
  const ended = await store.transition(session.id, from, outcome, rt.clock.now(), {
    ...patch,
    unsettled: outcome,
  });
  if (ended) await settle(rt, session, outcome);
  return ended;
}

/**
 * Ends the sessions still open on an envelope that just reached a final state without the
 * eSign: declined, voided or expired.
 */
export async function closeSessions(rt: Runtime, envelope: Envelope): Promise<void> {
  const store = rt.store.esign;
  if (!store || !isFinal(envelope) || envelope.status === 'completed') return;
  if (!envelope.recipients.some((r) => r.auth === 'aadhaar')) return;
  for (const session of await store.open(envelope.id)) {
    const recipient = envelope.recipients.find((r) => r.id === session.recipientId);
    const outcome: EsignOutcome =
      envelope.status === 'expired'
        ? 'expired'
        : recipient?.status === 'declined'
          ? 'declined'
          : 'failed';
    await endSession(rt, session, OPEN_STATUSES, outcome);
  }
}
