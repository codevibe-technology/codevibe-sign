import { addDocument, addField, addRecipient, createEnvelope } from './builder';
import type { Clock, IdGenerator } from './ports';
import type { Envelope, Id, TransitionResult } from './types';

export interface RecallCopyOptions {
  /** Where the copy of document `index` is stored; the caller copies the original file there. */
  fileKey: (envelopeId: Id, index: number) => string;
  /** Who made the copy, for the audit trail. */
  by?: string;
  /** `recalled` (default) for a recalled envelope, `revised` for one revised after a decline. */
  origin?: 'recalled' | 'revised';
}

/**
 * A new draft with the same documents, recipients (role, order, how they sign), fields,
 * title, message and reminders as `envelope`, for correcting and sending again. Nothing anyone
 * signed is carried over; values the sender filled in before sending are. The expiry keeps
 * the same length, counted from now.
 */
export function recallCopy(
  envelope: Envelope,
  deps: { clock: Clock; ids: IdGenerator },
  options: RecallCopyOptions,
): TransitionResult {
  const now = deps.clock.now();
  const length =
    envelope.expiresAt && envelope.sentAt
      ? Date.parse(envelope.expiresAt) - Date.parse(envelope.sentAt)
      : 0;
  const created = createEnvelope(
    {
      title: envelope.title,
      routing: envelope.routing,
      reminders: envelope.reminders,
      ...(envelope.message !== undefined ? { message: envelope.message } : {}),
      ...(length > 0 ? { expiresAt: new Date(now.getTime() + length).toISOString() } : {}),
      ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
    },
    deps,
  );
  let copy = created.envelope;
  const documents = new Map<Id, Id>();
  envelope.documents.forEach((document, index) => {
    const added = addDocument(
      copy,
      {
        name: document.name,
        sha256: document.sha256,
        pageCount: document.pageCount,
        fileKey: options.fileKey(copy.id, index),
        ...(document.pageSizes ? { pageSizes: document.pageSizes } : {}),
      },
      deps,
    );
    copy = added.envelope;
    documents.set(document.id, added.document.id);
  });
  const recipients = new Map<Id, Id>();
  for (const r of envelope.recipients) {
    const added = addRecipient(
      copy,
      {
        name: r.name,
        role: r.role,
        order: r.order,
        auth: r.auth,
        ...(r.email ? { email: r.email } : {}),
        ...(r.phone ? { phone: r.phone } : {}),
      },
      deps,
    );
    copy = added.envelope;
    recipients.set(r.id, added.recipient.id);
  }
  const prefilled = new Map(envelope.values.map((v) => [v.fieldId, v.value]));
  for (const f of envelope.fields) {
    const added = addField(
      copy,
      {
        documentId: documents.get(f.documentId)!,
        recipientId: recipients.get(f.recipientId)!,
        type: f.type,
        page: f.page,
        rect: f.rect,
        required: f.required,
        ...(f.label !== undefined ? { label: f.label } : {}),
        ...(f.readOnly ? { readOnly: true } : {}),
      },
      deps,
    );
    copy = added.envelope;
    const value = f.readOnly ? prefilled.get(f.id) : undefined;
    if (value !== undefined) {
      copy = { ...copy, values: [...copy.values, { fieldId: added.field.id, value }] };
    }
  }
  const [event, ...rest] = created.events;
  return {
    envelope: copy,
    events: [
      {
        ...event!,
        data: {
          ...event!.data,
          ...(options.origin === 'revised'
            ? { revisedFrom: envelope.id, revisedFromTitle: envelope.title }
            : { recalledFrom: envelope.id, recalledFromTitle: envelope.title }),
          ...(options.by ? { by: options.by } : {}),
        },
      },
      ...rest,
    ],
    effects: created.effects,
  };
}
