import {
  addDocument,
  addField,
  addRecipient,
  createEnvelope,
  type RecipientInput,
} from '../builder';
import type { Clock, IdGenerator } from '../ports';
import type { Envelope, RoutingMode, ReminderPolicy } from '../types';
import { SignError, type SignErrorCode } from '../types';

export const T0 = '2026-03-01T10:00:00.000Z';
export const SHA = 'a'.repeat(64);
/** A real 1x1 PNG. */
export const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function clockAt(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export function at(days: number, from = T0): string {
  return new Date(Date.parse(from) + days * 86_400_000).toISOString();
}

export function counterIds(prefix = 'id'): IdGenerator {
  let n = 0;
  return { id: () => `${prefix}${++n}` };
}

export const deps = (iso = T0) => ({ clock: clockAt(iso), ids: counterIds() });

export function draft(
  options: { routing?: RoutingMode; reminders?: ReminderPolicy; expiresAt?: string } = {},
) {
  const d = deps();
  const { envelope } = createEnvelope({ title: 'Offer letter', ...options }, d);
  const added = addDocument(
    envelope,
    {
      name: 'offer.pdf',
      sha256: SHA,
      pageCount: 2,
      fileKey: 'files/offer.pdf',
      pageSizes: [
        { width: 612, height: 792 },
        { width: 612, height: 792 },
      ],
    },
    d,
  );
  return { envelope: added.envelope, documentId: added.document.id, ids: d.ids };
}

export interface ReadyOptions {
  routing?: RoutingMode;
  reminders?: ReminderPolicy;
  expiresAt?: string;
  recipients?: RecipientInput[];
}

/**
 * A draft ready to send. Signers get a required signature field and an optional text field;
 * approvers get no fields. Returns recipient ids in input order.
 */
export function ready(options: ReadyOptions = {}): {
  envelope: Envelope;
  ids: string[];
  documentId: string;
} {
  const start = draft(options);
  let envelope = start.envelope;
  const ids: string[] = [];
  const recipients = options.recipients ?? [
    { name: 'Asha', email: 'asha@example.com' },
    { name: 'Ravi', email: 'ravi@example.com' },
  ];
  for (const input of recipients) {
    const added = addRecipient(envelope, input, start);
    envelope = added.envelope;
    ids.push(added.recipient.id);
    if ((input.role ?? 'signer') === 'signer') {
      const rect = { x: 50, y: 600, width: 200, height: 50 };
      envelope = addField(
        envelope,
        {
          documentId: start.documentId,
          recipientId: added.recipient.id,
          type: 'signature',
          page: 1,
          rect,
        },
        start,
      ).envelope;
      envelope = addField(
        envelope,
        {
          documentId: start.documentId,
          recipientId: added.recipient.id,
          type: 'text',
          page: 0,
          rect,
          required: false,
        },
        start,
      ).envelope;
    }
  }
  return { envelope, ids, documentId: start.documentId };
}

export function fieldsOf(envelope: Envelope, recipientId: string) {
  return envelope.fields.filter((f) => f.recipientId === recipientId);
}

/** Values for every required field of a recipient. */
export function valuesFor(envelope: Envelope, recipientId: string) {
  return fieldsOf(envelope, recipientId)
    .filter((f) => f.required)
    .map((f) => ({
      fieldId: f.id,
      value:
        f.type === 'checkbox'
          ? 'true'
          : f.type === 'signature' || f.type === 'initials'
            ? PNG
            : 'ok',
    }));
}

export function errorCode(fn: () => unknown): SignErrorCode | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof SignError) return error.code;
    throw error;
  }
  return undefined;
}

export function issuePaths(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof SignError && error.code === 'VALIDATION') {
      return (error.details?.issues as { path: string }[]).map((i) => i.path);
    }
    throw error;
  }
  return [];
}
