import {
  addDocument,
  addField,
  addRecipient,
  moveField,
  prefillFields,
  removeDocument,
  removeField,
  removeRecipient,
  updateEnvelope,
  updateRecipient,
  type DocumentInput,
  type EnvelopePatch,
  type FieldInput,
  type FieldMove,
  type RecipientInput,
  type RecipientPatch,
} from './builder';
import type { Clock, IdGenerator } from './ports';
import type {
  AuditContext,
  Document,
  Envelope,
  Field,
  FieldValue,
  Id,
  PendingAuditEvent,
  Recipient,
  TransitionResult,
} from './types';

export interface DraftEditDeps {
  clock: Clock;
}

export interface DraftEditOptions {
  /** The sender's network details, recorded on the event. */
  context?: AuditContext;
}

/** What changed in a draft, recorded as `data.change` on the `envelope.updated` event. */
export type DraftChange =
  | 'details.updated'
  | 'document.added'
  | 'document.removed'
  | 'recipient.added'
  | 'recipient.updated'
  | 'recipient.removed'
  | 'field.added'
  | 'field.moved'
  | 'field.removed'
  | 'values.prefilled';

type EventData = NonNullable<PendingAuditEvent['data']>;

function edited(
  envelope: Envelope,
  deps: DraftEditDeps,
  options: DraftEditOptions,
  change: DraftChange,
  extra: { recipientId?: Id; data?: EventData } = {},
): TransitionResult {
  const event: PendingAuditEvent = {
    envelopeId: envelope.id,
    action: 'envelope.updated',
    at: deps.clock.now().toISOString(),
    ...(extra.recipientId !== undefined && { recipientId: extra.recipientId }),
    ...(options.context !== undefined && { context: { ...options.context } }),
    data: { change, ...extra.data },
  };
  return { envelope, events: [event], effects: [] };
}

const unchanged = (envelope: Envelope): TransitionResult => ({
  envelope,
  events: [],
  effects: [],
});

/** Names of the keys a patch sets, sorted, for the audit record. */
const patchedKeys = (patch: object): string =>
  Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort()
    .join(',');

const fieldCount = (envelope: Envelope) => envelope.fields.length;

/** `updateEnvelope` that also returns an `envelope.updated` event naming the changed keys. */
export function updateEnvelopeWithEvents(
  envelope: Envelope,
  patch: EnvelopePatch,
  deps: DraftEditDeps,
  options: DraftEditOptions = {},
): TransitionResult {
  const next = updateEnvelope(envelope, patch, deps);
  const keys = patchedKeys(patch);
  if (!keys) return unchanged(next);
  return edited(next, deps, options, 'details.updated', { data: { fields: keys } });
}

export function addDocumentWithEvents(
  envelope: Envelope,
  input: DocumentInput,
  deps: DraftEditDeps & { ids: IdGenerator },
  options: DraftEditOptions = {},
): TransitionResult & { document: Document } {
  const added = addDocument(envelope, input, deps);
  const { document } = added;
  return {
    ...edited(added.envelope, deps, options, 'document.added', {
      data: {
        documentId: document.id,
        name: document.name,
        sha256: document.sha256,
        pageCount: document.pageCount,
      },
    }),
    document,
  };
}

export function removeDocumentWithEvents(
  envelope: Envelope,
  documentId: Id,
  deps: DraftEditDeps,
  options: DraftEditOptions = {},
): TransitionResult {
  const next = removeDocument(envelope, documentId);
  return edited(next, deps, options, 'document.removed', {
    data: { documentId, fieldsRemoved: fieldCount(envelope) - fieldCount(next) },
  });
}

export function addRecipientWithEvents(
  envelope: Envelope,
  input: RecipientInput,
  deps: DraftEditDeps & { ids: IdGenerator },
  options: DraftEditOptions = {},
): TransitionResult & { recipient: Recipient } {
  const added = addRecipient(envelope, input, deps);
  const { recipient } = added;
  return {
    ...edited(added.envelope, deps, options, 'recipient.added', {
      recipientId: recipient.id,
      data: { role: recipient.role, order: recipient.order, auth: recipient.auth },
    }),
    recipient,
  };
}

/** `updateRecipient` that also returns an `envelope.updated` event naming the changed keys. */
export function updateRecipientWithEvents(
  envelope: Envelope,
  recipientId: Id,
  patch: RecipientPatch,
  deps: DraftEditDeps,
  options: DraftEditOptions = {},
): TransitionResult {
  const next = updateRecipient(envelope, recipientId, patch);
  // A key given as undefined clears an email or phone, so it counts as a change here.
  const keys = Object.keys(patch).sort().join(',');
  if (!keys) return unchanged(next);
  return edited(next, deps, options, 'recipient.updated', { recipientId, data: { fields: keys } });
}

export function removeRecipientWithEvents(
  envelope: Envelope,
  recipientId: Id,
  deps: DraftEditDeps,
  options: DraftEditOptions = {},
): TransitionResult {
  const next = removeRecipient(envelope, recipientId);
  return edited(next, deps, options, 'recipient.removed', {
    recipientId,
    data: { fieldsRemoved: fieldCount(envelope) - fieldCount(next) },
  });
}

const fieldData = (field: Field): EventData => ({
  fieldId: field.id,
  type: field.type,
  documentId: field.documentId,
  page: field.page,
});

export function addFieldWithEvents(
  envelope: Envelope,
  input: FieldInput,
  deps: DraftEditDeps & { ids: IdGenerator },
  options: DraftEditOptions = {},
): TransitionResult & { field: Field } {
  const added = addField(envelope, input, deps);
  const { field } = added;
  return {
    ...edited(added.envelope, deps, options, 'field.added', {
      recipientId: field.recipientId,
      data: fieldData(field),
    }),
    field,
  };
}

export function moveFieldWithEvents(
  envelope: Envelope,
  fieldId: Id,
  to: FieldMove,
  deps: DraftEditDeps,
  options: DraftEditOptions = {},
): TransitionResult {
  const next = moveField(envelope, fieldId, to);
  const field = next.fields.find((f) => f.id === fieldId)!;
  return edited(next, deps, options, 'field.moved', {
    recipientId: field.recipientId,
    data: fieldData(field),
  });
}

export function removeFieldWithEvents(
  envelope: Envelope,
  fieldId: Id,
  deps: DraftEditDeps,
  options: DraftEditOptions = {},
): TransitionResult {
  const next = removeField(envelope, fieldId);
  const field = envelope.fields.find((f) => f.id === fieldId)!;
  return edited(next, deps, options, 'field.removed', {
    recipientId: field.recipientId,
    data: fieldData(field),
  });
}

/**
 * `prefillFields` that also returns an `envelope.updated` event. The event lists the field
 * ids only: prefilled values can be personal data, and they are kept on the envelope anyway.
 */
export function prefillFieldsWithEvents(
  envelope: Envelope,
  values: readonly FieldValue[],
  deps: DraftEditDeps,
  options: DraftEditOptions = {},
): TransitionResult {
  const next = prefillFields(envelope, values);
  if (values.length === 0) return unchanged(next);
  const ids = [...new Set(values.map((v) => v.fieldId))];
  return edited(next, deps, options, 'values.prefilled', { data: { fieldIds: ids.join(',') } });
}
