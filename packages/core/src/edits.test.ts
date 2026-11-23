import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commitTransition, verifyChain } from './audit';
import {
  addDocument,
  addField,
  addRecipient,
  createEnvelope,
  moveField,
  prefillFields,
  removeDocument,
  removeField,
  removeRecipient,
  updateEnvelope,
  updateRecipient,
} from './builder';
import { webCryptoHasher as hasher } from './defaults';
import {
  addDocumentWithEvents,
  addFieldWithEvents,
  addRecipientWithEvents,
  moveFieldWithEvents,
  prefillFieldsWithEvents,
  removeDocumentWithEvents,
  removeFieldWithEvents,
  removeRecipientWithEvents,
  updateEnvelopeWithEvents,
  updateRecipientWithEvents,
} from './edits';
import { at, clockAt, counterIds, errorCode, ready, SHA, T0 } from './test/fixtures';
import type { AuditEvent, Envelope, TransitionResult } from './types';

const rect = { x: 10, y: 10, width: 100, height: 40 };
const later = at(0.5);
const deps = (ids = counterIds('n')) => ({ clock: clockAt(later), ids });
const context = { ip: '10.0.0.1', userAgent: 'test' };

const only = (result: TransitionResult) => {
  expect(result.events).toHaveLength(1);
  expect(result.effects).toEqual([]);
  return result.events[0]!;
};

describe('draft edits with events', () => {
  it('records envelope detail changes by key, never by value', () => {
    const { envelope } = ready();
    const result = updateEnvelopeWithEvents(
      envelope,
      { title: 'Revised', message: undefined, expiresAt: at(30) },
      deps(),
      { context },
    );
    expect(result.envelope).toEqual(
      updateEnvelope(envelope, { title: 'Revised', expiresAt: at(30) }, deps()),
    );
    expect(only(result)).toEqual({
      envelopeId: envelope.id,
      action: 'envelope.updated',
      at: later,
      context,
      data: { change: 'details.updated', fields: 'expiresAt,title' },
    });
  });

  it('returns no event for an empty patch', () => {
    const { envelope } = ready();
    expect(updateEnvelopeWithEvents(envelope, {}, deps()).events).toEqual([]);
    expect(
      updateRecipientWithEvents(envelope, envelope.recipients[0]!.id, {}, deps()).events,
    ).toEqual([]);
    expect(prefillFieldsWithEvents(envelope, [], deps()).events).toEqual([]);
  });

  it('records documents added and removed', () => {
    const { envelope, documentId } = ready();
    const input = { name: 'nda.pdf', sha256: SHA, pageCount: 1, fileKey: 'k' };
    const added = addDocumentWithEvents(envelope, input, deps());
    expect(added.document).toEqual(addDocument(envelope, input, deps()).document);
    expect(only(added).data).toEqual({
      change: 'document.added',
      documentId: added.document.id,
      name: 'nda.pdf',
      sha256: SHA,
      pageCount: 1,
    });
    const removed = removeDocumentWithEvents(envelope, documentId, deps());
    expect(removed.envelope).toEqual(removeDocument(envelope, documentId));
    expect(only(removed).data).toEqual({
      change: 'document.removed',
      documentId,
      fieldsRemoved: envelope.fields.length,
    });
  });

  it('records recipient changes against the recipient', () => {
    const { envelope, ids } = ready();
    const input = { name: 'Neha', email: 'neha@example.com', role: 'approver' as const };
    const added = addRecipientWithEvents(envelope, input, deps());
    expect(added.recipient).toEqual(addRecipient(envelope, input, deps()).recipient);
    expect(only(added)).toMatchObject({
      recipientId: added.recipient.id,
      data: { change: 'recipient.added', role: 'approver', order: 3, auth: 'email_otp' },
    });

    const patch = { name: 'Asha Rao', phone: undefined };
    const updated = updateRecipientWithEvents(envelope, ids[0]!, patch, deps());
    expect(updated.envelope).toEqual(updateRecipient(envelope, ids[0]!, patch));
    expect(only(updated)).toMatchObject({
      recipientId: ids[0],
      data: { change: 'recipient.updated', fields: 'name,phone' },
    });

    const removed = removeRecipientWithEvents(envelope, ids[1]!, deps());
    expect(removed.envelope).toEqual(removeRecipient(envelope, ids[1]!));
    expect(only(removed)).toMatchObject({
      recipientId: ids[1],
      data: { change: 'recipient.removed', fieldsRemoved: 2 },
    });
  });

  it('records fields added, moved and removed', () => {
    const { envelope, ids, documentId } = ready();
    const input = { documentId, recipientId: ids[0]!, type: 'initials' as const, page: 1, rect };
    const added = addFieldWithEvents(envelope, input, deps());
    expect(added.field).toEqual(addField(envelope, input, deps()).field);
    const fieldData = { fieldId: added.field.id, type: 'initials', documentId, page: 1 };
    expect(only(added)).toMatchObject({
      recipientId: ids[0],
      data: { change: 'field.added', ...fieldData },
    });

    const moved = moveFieldWithEvents(added.envelope, added.field.id, { rect, page: 0 }, deps());
    expect(moved.envelope).toEqual(moveField(added.envelope, added.field.id, { rect, page: 0 }));
    expect(only(moved).data).toEqual({ change: 'field.moved', ...fieldData, page: 0 });

    const removed = removeFieldWithEvents(added.envelope, added.field.id, deps());
    expect(removed.envelope).toEqual(removeField(added.envelope, added.field.id));
    expect(only(removed).data).toEqual({ change: 'field.removed', ...fieldData });
  });

  it('records which fields were prefilled without the values', () => {
    const { envelope } = ready();
    const text = envelope.fields.find((f) => f.type === 'text')!;
    const values = [{ fieldId: text.id, value: 'Aadhaar 1234' }];
    const result = prefillFieldsWithEvents(envelope, values, deps());
    expect(result.envelope).toEqual(prefillFields(envelope, values));
    const event = only(result);
    expect(event.data).toEqual({ change: 'values.prefilled', fieldIds: text.id });
    expect(event).not.toHaveProperty('recipientId');
    expect(JSON.stringify(result.events)).not.toContain('Aadhaar');
  });

  it('applies the same rules as the plain edits', () => {
    const { envelope, ids } = ready();
    const sent = { ...envelope, status: 'sent' as const };
    expect(errorCode(() => updateEnvelopeWithEvents(sent, { title: 'x' }, deps()))).toBe(
      'INVALID_STATE',
    );
    expect(errorCode(() => removeRecipientWithEvents(envelope, 'nobody', deps()))).toBe(
      'RECIPIENT_NOT_FOUND',
    );
    expect(errorCode(() => removeFieldWithEvents(envelope, 'nope', deps()))).toBe('VALIDATION');
    expect(
      errorCode(() => updateRecipientWithEvents(envelope, ids[0]!, { email: 'bad' }, deps())),
    ).toBe('VALIDATION');
  });
});

type Edit =
  | { kind: 'title'; title: string }
  | { kind: 'recipient' }
  | { kind: 'field' }
  | { kind: 'move' }
  | { kind: 'remove-field' };

const edit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({
    kind: fc.constant('title' as const),
    title: fc.string({ minLength: 1, maxLength: 20 }),
  }),
  fc.constant({ kind: 'recipient' as const }),
  fc.constant({ kind: 'field' as const }),
  fc.constant({ kind: 'move' as const }),
  fc.constant({ kind: 'remove-field' as const }),
);

describe('draft edits with events (properties)', () => {
  it('give the same envelope as the plain edits and an audit chain that verifies', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(edit, { maxLength: 12 }), async (edits) => {
        const d = { clock: clockAt(T0), ids: counterIds('p') };
        const fixed = (id: string) => ({ ids: { id: () => id } });
        const log: AuditEvent[] = [];
        let current: Envelope | undefined;
        const commit = async (result: TransitionResult) => {
          const base = { ...result.envelope, auditHead: current?.auditHead };
          const committed = await commitTransition(
            { ...result, envelope: base },
            log.length + 1,
            hasher,
          );
          log.push(...committed.events);
          current = committed.envelope;
          return current;
        };

        const created = createEnvelope({ title: 'Draft' }, d);
        let plain = created.envelope;
        await commit(created);
        const docInput = { name: 'a.pdf', sha256: SHA, pageCount: 1, fileKey: 'k' };
        const doc = addDocumentWithEvents(current!, docInput, d);
        plain = addDocument(plain, docInput, fixed(doc.document.id)).envelope;
        await commit(doc);
        let n = 0;

        for (const step of edits) {
          const envelope = current!;
          if (step.kind === 'title' && step.title.trim()) {
            plain = updateEnvelope(plain, { title: step.title }, d);
            await commit(updateEnvelopeWithEvents(envelope, { title: step.title }, d));
          } else if (step.kind === 'recipient') {
            const input = { name: `R${++n}`, email: `r${n}@example.com` };
            const added = addRecipientWithEvents(envelope, input, d);
            plain = addRecipient(plain, input, fixed(added.recipient.id)).envelope;
            await commit(added);
          } else if (step.kind === 'field' && envelope.recipients.length > 0) {
            const input = {
              documentId: doc.document.id,
              recipientId: envelope.recipients.at(-1)!.id,
              type: 'text' as const,
              page: 0,
              rect,
            };
            const added = addFieldWithEvents(envelope, input, d);
            plain = addField(plain, input, fixed(added.field.id)).envelope;
            await commit(added);
          } else if (step.kind === 'move' && envelope.fields.length > 0) {
            const id = envelope.fields[0]!.id;
            const to = { rect: { ...rect, x: rect.x + 1 } };
            plain = moveField(plain, id, to);
            await commit(moveFieldWithEvents(envelope, id, to, d));
          } else if (step.kind === 'remove-field' && envelope.fields.length > 0) {
            const id = envelope.fields.at(-1)!.id;
            plain = removeField(plain, id);
            await commit(removeFieldWithEvents(envelope, id, d));
          }
        }

        const { auditHead, ...edited } = current!;
        expect(edited).toEqual(plain);
        expect(log.slice(1).every((e) => e.action === 'envelope.updated')).toBe(true);
        expect(await verifyChain(log, hasher, { expectedHead: auditHead })).toEqual({
          valid: true,
          head: auditHead,
        });
      }),
      { numRuns: 50 },
    );
  });
});
