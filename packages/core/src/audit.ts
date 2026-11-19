import type { Hasher } from './ports';
import type { AuditEvent, Effect, Envelope, PendingAuditEvent, TransitionResult } from './types';

export const GENESIS_HASH = '0'.repeat(64);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Audit data must not contain NaN or Infinity');
    return value;
  }
  if (Array.isArray(value))
    return value.map((item) => (item === undefined ? null : normalize(item)));
  if (typeof value === 'object') {
    // No prototype, so a `__proto__` key is kept as data instead of being swallowed by the setter.
    const out: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = normalize(item);
    }
    return out;
  }
  throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`);
}

/**
 * Canonical JSON of an audit event: keys sorted at every level, undefined members dropped,
 * and the chain fields (`prevHash`, `hash`) left out so the result is what gets hashed.
 */
export function canonicalize(
  event: PendingAuditEvent | Omit<AuditEvent, 'prevHash' | 'hash'>,
): string {
  const rest: Record<string, unknown> = { ...event };
  delete rest.prevHash;
  delete rest.hash;
  return stableStringify(rest);
}

/** `sha256(prevHash + canonicalize(event))`, where the event includes its `seq`. */
export function hashEvent(
  prevHash: string,
  event: Omit<AuditEvent, 'prevHash' | 'hash'>,
  hasher: Hasher,
): Promise<string> {
  return hasher.sha256(prevHash + canonicalize(event));
}

/**
 * Places pending events on the chain. `prevHead` is the hash of the last stored event
 * (undefined or empty for a new envelope) and `seqStart` the seq of the first new event.
 */
export async function appendEvents(
  prevHead: string | undefined,
  seqStart: number,
  events: readonly PendingAuditEvent[],
  hasher: Hasher,
): Promise<AuditEvent[]> {
  if (!Number.isInteger(seqStart) || seqStart < 1) {
    throw new RangeError('seqStart must be an integer of at least 1');
  }
  const chained: AuditEvent[] = [];
  let prevHash = prevHead || GENESIS_HASH;
  for (const [index, event] of events.entries()) {
    const withSeq = { ...event, seq: seqStart + index };
    const hash = await hashEvent(prevHash, withSeq, hasher);
    chained.push({ ...withSeq, prevHash, hash });
    prevHash = hash;
  }
  return chained;
}

export type ChainVerification =
  | { valid: true; head: string }
  | {
      valid: false;
      /** Index in the given array of the first event that does not fit the chain. */
      brokenAt: number;
      reason: 'seq' | 'prev_hash' | 'hash' | 'envelope' | 'head';
    };

export interface VerifyChainOptions {
  /** For example `envelope.auditHead`; detects events cut off the end of the log. */
  expectedHead?: string;
  /**
   * The envelope the log must belong to. Without it, every event only has to match the
   * first one, so a complete log of a different envelope would still verify.
   */
  envelopeId?: string;
}

/** Recomputes every hash from the genesis value, and checks the options given. */
export async function verifyChain(
  events: readonly AuditEvent[],
  hasher: Hasher,
  options: VerifyChainOptions = {},
): Promise<ChainVerification> {
  let prevHash = GENESIS_HASH;
  const envelopeId = options.envelopeId ?? events[0]?.envelopeId;
  for (const [index, event] of events.entries()) {
    if (event.seq !== index + 1) return { valid: false, brokenAt: index, reason: 'seq' };
    if (event.envelopeId !== envelopeId)
      return { valid: false, brokenAt: index, reason: 'envelope' };
    if (event.prevHash !== prevHash) return { valid: false, brokenAt: index, reason: 'prev_hash' };
    const expected = await hashEvent(prevHash, event, hasher);
    if (expected !== event.hash) return { valid: false, brokenAt: index, reason: 'hash' };
    prevHash = event.hash;
  }
  if (options.expectedHead !== undefined && options.expectedHead !== prevHash) {
    return { valid: false, brokenAt: events.length, reason: 'head' };
  }
  return { valid: true, head: prevHash };
}

export interface CommittedTransition {
  envelope: Envelope;
  events: AuditEvent[];
  effects: Effect[];
}

/**
 * Chains a transition's events after the envelope's current head and records the new
 * head on the envelope. `nextSeq` is one more than the number of events already stored.
 */
export async function commitTransition(
  result: TransitionResult,
  nextSeq: number,
  hasher: Hasher,
): Promise<CommittedTransition> {
  const events = await appendEvents(result.envelope.auditHead, nextSeq, result.events, hasher);
  const head = events.at(-1)?.hash;
  const envelope = head ? { ...result.envelope, auditHead: head } : result.envelope;
  return { envelope, events, effects: result.effects };
}
