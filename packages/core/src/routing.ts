import { isActor } from './builder';
import type { Envelope, EnvelopeStatus, Recipient, RecipientStatus } from './types';
import { FINAL_ENVELOPE_STATUSES } from './types';

export const DAY_MS = 86_400_000;

const DONE: readonly RecipientStatus[] = ['signed', 'approved', 'declined'];

export function isFinal(envelopeOrStatus: Envelope | EnvelopeStatus): boolean {
  const status = typeof envelopeOrStatus === 'string' ? envelopeOrStatus : envelopeOrStatus.status;
  return FINAL_ENVELOPE_STATUSES.includes(status);
}

export function isActive(envelope: Envelope): boolean {
  return envelope.status === 'sent' || envelope.status === 'in_progress';
}

export function hasActed(recipient: Recipient): boolean {
  return DONE.includes(recipient.status);
}

export function isExpiredAt(envelope: Envelope, now: Date): boolean {
  return envelope.expiresAt !== undefined && now.getTime() >= Date.parse(envelope.expiresAt);
}

/**
 * Signers and approvers who may act now. Parallel routing: everyone who has not acted.
 * Sequential routing: those who have not acted with the lowest order; equal orders act together.
 * Empty unless the envelope is sent or in progress.
 */
export function currentRecipients(envelope: Envelope): Recipient[] {
  if (!isActive(envelope)) return [];
  const waiting = envelope.recipients.filter((r) => isActor(r) && !hasActed(r));
  if (envelope.routing === 'parallel' || waiting.length === 0) return waiting;
  const lowest = Math.min(...waiting.map((r) => r.order));
  return waiting.filter((r) => r.order === lowest);
}

/** When the next reminder is due for a recipient, or undefined if none will be sent. */
export function nextReminderAt(envelope: Envelope, recipient: Recipient): Date | undefined {
  const { firstAfterDays, everyDays, max } = envelope.reminders;
  const sent = recipient.remindersSent ?? 0;
  if (firstAfterDays <= 0 || sent >= max || !recipient.notifiedAt) return undefined;
  if (recipient.status !== 'notified' && recipient.status !== 'viewed') return undefined;
  if (recipient.lastRemindedAt) {
    if (everyDays <= 0) return undefined;
    return new Date(Date.parse(recipient.lastRemindedAt) + everyDays * DAY_MS);
  }
  return new Date(Date.parse(recipient.notifiedAt) + firstAfterDays * DAY_MS);
}

/**
 * The earliest time `tick` has work to do (a reminder or the expiry), so a scheduler can
 * index envelopes by it. Undefined when nothing is scheduled.
 */
export function nextTickAt(envelope: Envelope): Date | undefined {
  if (!isActive(envelope)) return undefined;
  const times = currentRecipients(envelope)
    .map((r) => nextReminderAt(envelope, r)?.getTime())
    .filter((t): t is number => t !== undefined);
  if (envelope.expiresAt) times.push(Date.parse(envelope.expiresAt));
  return times.length === 0 ? undefined : new Date(Math.min(...times));
}
