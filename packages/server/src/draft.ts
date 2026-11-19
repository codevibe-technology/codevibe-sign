import {
  SignError,
  addField,
  addRecipient,
  removeField,
  removeRecipient,
  updateRecipient,
  type Envelope,
  type Id,
  type IdGenerator,
} from '@codevibe_technology/sign-core';
import { validation } from './errors';
import type { FieldSpec, RecipientSpec } from './input';

/** Runs a core builder and points its validation issues at the item in the request. */
function at<T>(prefix: string, local: string, build: () => T): T {
  try {
    return build();
  } catch (err) {
    if (err instanceof SignError && err.code === 'VALIDATION') {
      const issues = Array.isArray(err.details?.issues) ? err.details.issues : [];
      const rewritten = issues.map((issue: { path?: string; message?: string }) => ({
        path: `${prefix}${(issue.path ?? '').replace(new RegExp(`^${local}\\.?`), '.')}`.replace(
          /\.$/,
          '',
        ),
        message: issue.message ?? err.message,
      }));
      throw new SignError('VALIDATION', `${prefix}: ${err.message}`, { issues: rewritten });
    }
    throw err;
  }
}

/**
 * Replaces the draft's recipients and/or fields with the ones in a request, using the core
 * builders so every rule (roles, bounds, page sizes) is checked in one place. Fields name
 * documents and recipients by their key in the request or by id.
 */
export function applyParties(
  envelope: Envelope,
  documentKeys: Map<string, Id>,
  recipients: RecipientSpec[] | undefined,
  fields: FieldSpec[] | undefined,
  ids: IdGenerator,
): Envelope {
  let next = envelope;
  const recipientKeys = new Map<string, Id>(next.recipients.map((r) => [r.id, r.id]));

  if (recipients) {
    const kept = new Set(recipients.flatMap((r) => (r.id ? [r.id] : [])));
    for (const existing of envelope.recipients) {
      if (!kept.has(existing.id)) next = removeRecipient(next, existing.id);
    }
    recipientKeys.clear();
    recipients.forEach((spec, i) => {
      const prefix = `recipients[${i}]`;
      if (spec.id) {
        const id = spec.id;
        next = at(prefix, 'recipient', () => updateRecipient(next, id, spec.input));
        recipientKeys.set(spec.key, id);
        recipientKeys.set(id, id);
      } else {
        const added = at(prefix, 'recipient', () => addRecipient(next, spec.input, { ids }));
        next = added.envelope;
        recipientKeys.set(spec.key, added.recipient.id);
      }
    });
  }

  if (fields) {
    for (const field of next.fields) next = removeField(next, field.id);
    fields.forEach((spec, i) => {
      const prefix = `fields[${i}]`;
      const documentId =
        spec.document !== undefined
          ? documentKeys.get(spec.document)
          : next.documents.length === 1
            ? next.documents[0]?.id
            : undefined;
      if (!documentId) {
        throw validation(`${prefix}.document does not match any document`, {
          issues: [{ path: `${prefix}.document`, message: 'Name one of the documents' }],
        });
      }
      const recipientId = recipientKeys.get(spec.recipient);
      if (!recipientId) {
        throw validation(`${prefix}.recipient does not match any recipient`, {
          issues: [{ path: `${prefix}.recipient`, message: 'Name one of the recipients' }],
        });
      }
      next = at(prefix, 'field', () =>
        addField(next, { ...spec.input, documentId, recipientId }, { ids }),
      ).envelope;
    });
  }
  return next;
}
