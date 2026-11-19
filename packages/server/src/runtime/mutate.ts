import {
  SignError,
  commitTransition,
  hasActed,
  isFinal,
  type Envelope,
  type Id,
  type TransitionResult,
} from '@codevibe/sign-core';
import { VersionConflictError } from '../errors';
import type { Job } from '../store/types';
import type { Runtime } from './context';
import { dispatchJobs, effectsToJobs } from './jobs';

const MAX_ATTEMPTS = 3;

export type Apply = (envelope: Envelope) => TransitionResult | Promise<TransitionResult>;

export interface Mutation {
  envelope: Envelope;
  changed: boolean;
}

/**
 * Loads an envelope, applies a core transition, chains its audit events and saves it
 * together with the jobs for its effects. Retries from a fresh read when another request
 * saved first; the transition is pure, so running it again is safe.
 */
export async function mutate(rt: Runtime, id: Id, apply: Apply): Promise<Mutation> {
  for (let attempt = 1; ; attempt++) {
    const stored = await rt.store.load(id);
    if (!stored) throw new SignError('ENVELOPE_NOT_FOUND', 'Envelope not found');
    const result = await apply(structuredClone(stored.envelope));
    if (result.events.length === 0 && result.effects.length === 0) {
      return { envelope: stored.envelope, changed: false };
    }
    const nextSeq = (await rt.store.listEvents(id)).length + 1;
    const committed = await commitTransition(result, nextSeq, rt.hasher);
    const jobs = effectsToJobs(rt, committed.envelope, committed.effects);
    try {
      await rt.store.commit(committed.envelope, committed.events, stored.version, jobs);
    } catch (err) {
      if (err instanceof VersionConflictError && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
    await afterCommit(rt, stored.envelope, committed.envelope, jobs);
    return { envelope: committed.envelope, changed: true };
  }
}

/** Saves a brand-new envelope with its first events. */
export async function create(rt: Runtime, result: TransitionResult): Promise<Envelope> {
  const committed = await commitTransition(result, 1, rt.hasher);
  const jobs = effectsToJobs(rt, committed.envelope, committed.effects);
  await rt.store.commit(committed.envelope, committed.events, 0, jobs);
  await dispatchJobs(rt, jobs);
  return committed.envelope;
}

/** Signing links stop working once their recipient has acted or the envelope is final. */
async function afterCommit(rt: Runtime, before: Envelope, after: Envelope, jobs: Job[]) {
  const now = rt.clock.now();
  if (isFinal(after) && !isFinal(before)) {
    await rt.store.revokeTokens(after.id, undefined, now);
  } else {
    for (const recipient of after.recipients) {
      const previous = before.recipients.find((r) => r.id === recipient.id);
      if (hasActed(recipient) && !(previous && hasActed(previous))) {
        await rt.store.revokeTokens(after.id, recipient.id, now);
      }
    }
  }
  await dispatchJobs(rt, jobs);
}
