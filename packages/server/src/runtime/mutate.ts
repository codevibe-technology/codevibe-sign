import {
  SignError,
  commitTransition,
  hasActed,
  isFinal,
  type AuditEvent,
  type Envelope,
  type Id,
  type TransitionResult,
} from '@codevibe_technology/sign-core';
import { VersionConflictError } from '../errors';
import type { Job } from '../store/types';
import { DEFAULT_WORKSPACE } from '../tenancy';
import type { Runtime } from './context';
import { dispatchJobs, effectsToJobs } from './jobs';

const MAX_ATTEMPTS = 3;

export type Apply = (envelope: Envelope) => TransitionResult | Promise<TransitionResult>;

export interface Mutation {
  envelope: Envelope;
  changed: boolean;
}

export interface Scope {
  /** The envelope must belong to this workspace; otherwise it is reported as not found. */
  workspaceId: string;
}

/**
 * Loads an envelope, applies a core transition, chains its audit events and saves it
 * together with the jobs for its effects. Retries from a fresh read when another request
 * saved first; the transition is pure, so running it again is safe.
 */
export async function mutate(rt: Runtime, id: Id, apply: Apply, scope?: Scope): Promise<Mutation> {
  for (let attempt = 1; ; attempt++) {
    const stored = await rt.store.load(id);
    const owner = stored?.workspaceId ?? DEFAULT_WORKSPACE;
    if (!stored || (scope && scope.workspaceId !== owner)) {
      throw new SignError('ENVELOPE_NOT_FOUND', 'Envelope not found');
    }
    const result = await apply(structuredClone(stored.envelope));
    if (result.events.length === 0 && result.effects.length === 0) {
      return { envelope: stored.envelope, changed: false };
    }
    const nextSeq = (await rt.store.listEvents(id)).length + 1;
    const committed = await commitTransition(result, nextSeq, rt.hasher);
    const jobs = await effectsToJobs(rt, committed.envelope, committed.effects, owner);
    try {
      await rt.store.commit(committed.envelope, committed.events, stored.version, jobs);
    } catch (err) {
      if (err instanceof VersionConflictError && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
    await announce(rt, owner, committed.envelope.id, committed.events);
    await afterCommit(rt, stored.envelope, committed.envelope, committed.events, jobs);
    return { envelope: committed.envelope, changed: true };
  }
}

/** Saves a brand-new envelope with its first events, owned by `workspaceId`. */
export async function create(
  rt: Runtime,
  result: TransitionResult,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<Envelope> {
  const committed = await commitTransition(result, 1, rt.hasher);
  const jobs = await effectsToJobs(rt, committed.envelope, committed.effects, workspaceId);
  const options = workspaceId === DEFAULT_WORKSPACE ? undefined : { workspaceId };
  await rt.store.commit(committed.envelope, committed.events, 0, jobs, options);
  await announce(rt, workspaceId, committed.envelope.id, committed.events);
  await dispatchJobs(rt, jobs);
  return committed.envelope;
}

/** Tells `onEnvelopeChange` what was just saved. Its failures never undo or fail the change. */
async function announce(rt: Runtime, workspaceId: string, envelopeId: Id, events: AuditEvent[]) {
  if (!rt.onEnvelopeChange || events.length === 0) return;
  try {
    await rt.onEnvelopeChange({ workspaceId, envelopeId, actions: events.map((e) => e.action) });
  } catch (err) {
    rt.logger.error('onEnvelopeChange failed', {
      envelope: envelopeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Actions after which a recipient's earlier links must stop working. */
const REISSUE = new Set<string>(['recipient.corrected', 'recipient.link_shared']);

/**
 * Signing links stop working once their recipient has acted or the envelope is final, and
 * when a recipient was corrected or given a new link by hand. This runs before the jobs, so a
 * new invitation's link is issued after the old ones are revoked.
 */
async function afterCommit(
  rt: Runtime,
  before: Envelope,
  after: Envelope,
  events: AuditEvent[],
  jobs: Job[],
) {
  const now = rt.clock.now();
  if (isFinal(after) && !isFinal(before)) {
    await rt.store.revokeTokens(after.id, undefined, now);
  } else {
    const revoke = new Set(
      events.flatMap((e) => (REISSUE.has(e.action) && e.recipientId ? [e.recipientId] : [])),
    );
    for (const recipient of after.recipients) {
      const previous = before.recipients.find((r) => r.id === recipient.id);
      if (hasActed(recipient) && !(previous && hasActed(previous))) revoke.add(recipient.id);
    }
    for (const recipientId of revoke) await rt.store.revokeTokens(after.id, recipientId, now);
  }
  await dispatchJobs(rt, jobs);
}
