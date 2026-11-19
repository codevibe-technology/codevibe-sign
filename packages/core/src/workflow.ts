import { assertReadyToSend, isActor } from './builder';
import type { Clock } from './ports';
import {
  currentRecipients,
  hasActed,
  isActive,
  isExpiredAt,
  isFinal,
  nextReminderAt,
} from './routing';
import type {
  AuditAction,
  AuditContext,
  AuthMethod,
  Effect,
  Envelope,
  FieldValue,
  Id,
  PendingAuditEvent,
  Recipient,
  TransitionResult,
} from './types';
import { SignError } from './types';
import { checkFieldValue, isFilled, MAX_REASON_LENGTH } from './validation';

export interface WorkflowDeps {
  clock: Clock;
}

export interface RecipientAction {
  recipientId: Id;
  context?: AuditContext;
}

export interface SubmitInput extends RecipientAction {
  values: FieldValue[];
}

export interface DeclineInput extends RecipientAction {
  reason: string;
}

export interface AuthenticatedInput extends RecipientAction {
  /** Defaults to the recipient's configured method. */
  method?: AuthMethod;
}

export interface VoidInput {
  reason: string;
  context?: AuditContext;
}

export interface SealInput {
  documentId: Id;
  /** SHA-256 hex of the sealed file. */
  sha256: string;
  context?: AuditContext;
}

class Transition {
  readonly events: PendingAuditEvent[] = [];
  readonly effects: Effect[] = [];

  constructor(
    public envelope: Envelope,
    readonly at: string,
  ) {}

  event(
    action: AuditAction,
    extra: { recipientId?: Id; context?: AuditContext; data?: PendingAuditEvent['data'] } = {},
  ): void {
    this.events.push({
      envelopeId: this.envelope.id,
      action,
      at: this.at,
      ...(extra.recipientId !== undefined && { recipientId: extra.recipientId }),
      ...(extra.context !== undefined && { context: { ...extra.context } }),
      ...(extra.data !== undefined && { data: extra.data }),
    });
  }

  notify(recipientId: Id, reason: Extract<Effect, { kind: 'notify' }>['reason']): void {
    this.effects.push({ kind: 'notify', recipientId, reason });
  }

  updateRecipient(recipientId: Id, patch: Partial<Recipient>): void {
    this.envelope = {
      ...this.envelope,
      recipients: this.envelope.recipients.map((r) =>
        r.id === recipientId ? { ...r, ...patch } : r,
      ),
    };
  }

  /** One webhook per distinct action, after the other effects. */
  result(): TransitionResult {
    const actions = [...new Set(this.events.map((e) => e.action))];
    const webhooks: Effect[] = actions.map((event) => ({
      kind: 'webhook',
      event,
      envelopeId: this.envelope.id,
    }));
    return {
      envelope: this.envelope,
      events: this.events,
      effects: [...this.effects, ...webhooks],
    };
  }
}

function findRecipient(envelope: Envelope, recipientId: Id): Recipient {
  const recipient = envelope.recipients.find((r) => r.id === recipientId);
  if (!recipient) {
    throw new SignError('RECIPIENT_NOT_FOUND', 'Recipient not found in this envelope', {
      recipientId,
    });
  }
  return recipient;
}

function assertOpen(envelope: Envelope, now: Date): void {
  if (!isActive(envelope)) {
    throw new SignError('INVALID_STATE', `Envelope is ${envelope.status}`, {
      status: envelope.status,
    });
  }
  if (isExpiredAt(envelope, now)) {
    throw new SignError('ENVELOPE_EXPIRED', 'This envelope has expired', {
      expiresAt: envelope.expiresAt,
    });
  }
}

/** The recipient must be a signer or approver who has not acted and whose turn it is. */
function assertTurn(envelope: Envelope, recipient: Recipient): void {
  if (!isActor(recipient)) {
    throw new SignError('INVALID_STATE', 'Viewers do not sign or approve', {
      recipientId: recipient.id,
    });
  }
  if (hasActed(recipient)) {
    throw new SignError('INVALID_STATE', `Recipient has already ${recipient.status}`, {
      recipientId: recipient.id,
      status: recipient.status,
    });
  }
  if (!currentRecipients(envelope).some((r) => r.id === recipient.id)) {
    throw new SignError('NOT_YOUR_TURN', 'Earlier recipients have not finished yet', {
      recipientId: recipient.id,
    });
  }
}

function cleanReason(reason: string, path: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new SignError('VALIDATION', 'A reason is required', {
      issues: [{ path, message: 'A reason is required' }],
    });
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    const message = `Reason is longer than ${MAX_REASON_LENGTH} characters`;
    throw new SignError('VALIDATION', message, { issues: [{ path, message }] });
  }
  return trimmed;
}

/** Invites everyone whose turn has come and who has not been invited yet. */
function inviteCurrent(t: Transition): void {
  for (const recipient of currentRecipients(t.envelope)) {
    if (recipient.status !== 'pending') continue;
    t.updateRecipient(recipient.id, { status: 'notified', notifiedAt: t.at });
    t.event('recipient.notified', { recipientId: recipient.id });
    t.notify(recipient.id, 'invite');
  }
}

/** Tells everyone already involved that the envelope will not complete. */
function notifyCancelled(t: Transition, except?: Id): void {
  for (const recipient of t.envelope.recipients) {
    if (recipient.id === except || recipient.status === 'pending') continue;
    t.notify(recipient.id, 'cancelled');
  }
}

export function send(
  envelope: Envelope,
  deps: WorkflowDeps,
  options: { context?: AuditContext } = {},
): TransitionResult {
  if (envelope.status !== 'draft') {
    throw new SignError(
      'INVALID_STATE',
      `Only a draft can be sent (envelope is ${envelope.status})`,
      {
        status: envelope.status,
      },
    );
  }
  const now = deps.clock.now();
  assertReadyToSend(envelope, now);
  const t = new Transition(
    { ...envelope, status: 'sent', sentAt: now.toISOString() },
    now.toISOString(),
  );
  t.event('envelope.sent', { context: options.context, data: { routing: envelope.routing } });
  inviteCurrent(t);
  return t.result();
}

export function markViewed(
  envelope: Envelope,
  input: RecipientAction,
  deps: WorkflowDeps,
): TransitionResult {
  const now = deps.clock.now();
  assertOpen(envelope, now);
  const recipient = findRecipient(envelope, input.recipientId);
  if (isActor(recipient) && !hasActed(recipient)) assertTurn(envelope, recipient);

  const t = new Transition(envelope, now.toISOString());
  if (recipient.status === 'pending' || recipient.status === 'notified') {
    t.updateRecipient(recipient.id, { status: 'viewed', viewedAt: t.at });
  }
  t.event('recipient.viewed', { recipientId: recipient.id, context: input.context });
  return t.result();
}

export function markAuthenticated(
  envelope: Envelope,
  input: AuthenticatedInput,
  deps: WorkflowDeps,
): TransitionResult {
  const now = deps.clock.now();
  assertOpen(envelope, now);
  const recipient = findRecipient(envelope, input.recipientId);
  assertTurn(envelope, recipient);

  const t = new Transition(envelope, now.toISOString());
  t.event('recipient.authenticated', {
    recipientId: recipient.id,
    context: input.context,
    data: { method: input.method ?? recipient.auth },
  });
  return t.result();
}

/**
 * The recipient's values after this submission: what they sent, on top of what the sender
 * prefilled. Read-only fields keep the sender's value.
 */
function collectValues(
  envelope: Envelope,
  recipient: Recipient,
  submitted: FieldValue[],
  today: string,
): FieldValue[] {
  const own = new Map(
    envelope.fields.filter((f) => f.recipientId === recipient.id).map((f) => [f.id, f]),
  );
  const stored = new Map<Id, string>(
    envelope.values.filter((v) => own.has(v.fieldId)).map((v) => [v.fieldId, v.value]),
  );
  const seen = new Set<Id>();
  const invalid: { fieldId: Id; problem: string }[] = [];

  for (const { fieldId, value } of submitted) {
    const field = own.get(fieldId);
    if (!field) {
      const exists = envelope.fields.some((f) => f.id === fieldId);
      throw new SignError(
        'FIELD_NOT_YOURS',
        exists ? 'This field belongs to another recipient' : 'Unknown field',
        {
          fieldId,
        },
      );
    }
    if (seen.has(fieldId)) {
      invalid.push({ fieldId, problem: 'Value given more than once' });
      continue;
    }
    seen.add(fieldId);
    if (typeof value !== 'string') {
      invalid.push({ fieldId, problem: 'Value must be a string' });
      continue;
    }
    const checked = checkFieldValue(field.type, value);
    if (!checked.ok) {
      invalid.push({ fieldId, problem: checked.problem });
      continue;
    }
    if (field.readOnly) {
      // Echoing the sender's value back is harmless; changing it is not allowed.
      if (checked.value === (stored.get(fieldId) ?? '')) continue;
      throw new SignError('FIELD_NOT_YOURS', 'This field is filled in by the sender', {
        fieldId,
        readOnly: true,
      });
    }
    stored.set(fieldId, checked.value);
  }
  if (invalid.length > 0) {
    throw new SignError('INVALID_FIELD_VALUE', invalid[0]!.problem, { fields: invalid });
  }

  for (const field of own.values()) {
    if (stored.get(field.id)) continue;
    if (field.type === 'date_signed') stored.set(field.id, today);
    if (field.type === 'name') stored.set(field.id, recipient.name);
  }

  const missing = [...own.values()]
    .filter((f) => f.required && !isFilled(f, stored.get(f.id)))
    .map((f) => f.id);
  if (missing.length > 0) {
    throw new SignError('REQUIRED_FIELDS_MISSING', 'Fill in every required field', {
      fieldIds: missing,
    });
  }

  return [...own.values()]
    .filter((f) => stored.get(f.id) !== undefined && stored.get(f.id) !== '')
    .map((f) => ({ fieldId: f.id, value: stored.get(f.id)! }));
}

function complete(t: Transition): void {
  t.envelope = { ...t.envelope, status: 'completed', completedAt: t.at };
  t.event('envelope.completed');
  t.effects.push({ kind: 'seal', envelopeId: t.envelope.id });
  for (const recipient of t.envelope.recipients) t.notify(recipient.id, 'completed_copy');
}

/**
 * A signer signs (with field values) or an approver approves. Completes the envelope once
 * every signer and approver has acted; in sequential routing, invites the next group.
 */
export function submit(
  envelope: Envelope,
  input: SubmitInput,
  deps: WorkflowDeps,
): TransitionResult {
  const now = deps.clock.now();
  assertOpen(envelope, now);
  const recipient = findRecipient(envelope, input.recipientId);
  assertTurn(envelope, recipient);

  const at = now.toISOString();
  const values = collectValues(envelope, recipient, input.values, at.slice(0, 10));
  const ownFields = new Set(
    envelope.fields.filter((f) => f.recipientId === recipient.id).map((f) => f.id),
  );
  const t = new Transition(
    {
      ...envelope,
      status: 'in_progress',
      values: [...envelope.values.filter((v) => !ownFields.has(v.fieldId)), ...values],
    },
    at,
  );
  const signed = recipient.role === 'signer';
  t.updateRecipient(recipient.id, {
    status: signed ? 'signed' : 'approved',
    actedAt: at,
    ...(recipient.viewedAt === undefined && { viewedAt: at }),
  });
  t.event(signed ? 'recipient.signed' : 'recipient.approved', {
    recipientId: recipient.id,
    context: input.context,
    data: { fields: values.length },
  });

  if (currentRecipients(t.envelope).length === 0) complete(t);
  else inviteCurrent(t);
  return t.result();
}

/** Any signer or approver whose turn it is may decline; the envelope stops for everyone. */
export function decline(
  envelope: Envelope,
  input: DeclineInput,
  deps: WorkflowDeps,
): TransitionResult {
  const now = deps.clock.now();
  assertOpen(envelope, now);
  const recipient = findRecipient(envelope, input.recipientId);
  assertTurn(envelope, recipient);
  const reason = cleanReason(input.reason, 'reason');

  const t = new Transition({ ...envelope, status: 'declined' }, now.toISOString());
  t.updateRecipient(recipient.id, { status: 'declined', declineReason: reason, actedAt: t.at });
  t.event('recipient.declined', {
    recipientId: recipient.id,
    context: input.context,
    data: { reason },
  });
  t.event('envelope.declined', { recipientId: recipient.id });
  notifyCancelled(t, recipient.id);
  return t.result();
}

/** The sender withdraws the envelope. Allowed until it reaches a final state. */
export function voidEnvelope(
  envelope: Envelope,
  input: VoidInput,
  deps: WorkflowDeps,
): TransitionResult {
  if (isFinal(envelope)) {
    throw new SignError('INVALID_STATE', `Envelope is already ${envelope.status}`, {
      status: envelope.status,
    });
  }
  const reason = cleanReason(input.reason, 'reason');
  const now = deps.clock.now();
  const t = new Transition({ ...envelope, status: 'voided' }, now.toISOString());
  t.event('envelope.voided', { context: input.context, data: { reason } });
  notifyCancelled(t);
  return t.result();
}

/**
 * Housekeeping at `now`: expires the envelope once its expiry has passed, otherwise sends
 * the reminders that are due. Running it again at the same time does nothing.
 */
export function tick(envelope: Envelope, now: Date): TransitionResult {
  const t = new Transition(envelope, now.toISOString());
  if (!isActive(envelope)) return t.result();

  if (isExpiredAt(envelope, now)) {
    t.envelope = { ...envelope, status: 'expired' };
    t.event('envelope.expired', { data: { expiresAt: envelope.expiresAt! } });
    notifyCancelled(t);
    return t.result();
  }

  for (const recipient of currentRecipients(envelope)) {
    const due = nextReminderAt(envelope, recipient);
    if (!due || due.getTime() > now.getTime()) continue;
    const count = (recipient.remindersSent ?? 0) + 1;
    t.updateRecipient(recipient.id, { remindersSent: count, lastRemindedAt: t.at });
    t.event('recipient.reminded', { recipientId: recipient.id, data: { count } });
    t.notify(recipient.id, 'reminder');
  }
  return t.result();
}

/** Records that a completed envelope's document was sealed. Call once per sealed document. */
export function recordSeal(
  envelope: Envelope,
  input: SealInput,
  deps: WorkflowDeps,
): TransitionResult {
  if (envelope.status !== 'completed') {
    throw new SignError('INVALID_STATE', 'Only a completed envelope can be sealed', {
      status: envelope.status,
    });
  }
  if (!envelope.documents.some((d) => d.id === input.documentId)) {
    throw new SignError('VALIDATION', 'Document not found in this envelope', {
      issues: [{ path: 'documentId', message: 'Document not found in this envelope' }],
    });
  }
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new SignError('VALIDATION', 'SHA-256 must be 64 lowercase hex characters', {
      issues: [{ path: 'sha256', message: 'SHA-256 must be 64 lowercase hex characters' }],
    });
  }
  const t = new Transition(envelope, deps.clock.now().toISOString());
  t.event('document.sealed', {
    context: input.context,
    data: { documentId: input.documentId, sha256: input.sha256 },
  });
  return t.result();
}
