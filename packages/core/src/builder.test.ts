import { describe, expect, it } from 'vitest';
import {
  addDocument,
  addField,
  addRecipient,
  assertReadyToSend,
  createEnvelope,
  DEFAULT_REMINDERS,
  moveField,
  removeDocument,
  removeField,
  removeRecipient,
  updateEnvelope,
  updateRecipient,
  validateForSend,
} from './builder';
import { at, clockAt, deps, draft, errorCode, issuePaths, ready, SHA, T0 } from './test/fixtures';

const rect = { x: 10, y: 10, width: 100, height: 40 };
const now = new Date(T0);

describe('createEnvelope', () => {
  it('creates a draft with defaults and a created event', () => {
    const result = createEnvelope({ title: '  Offer letter ' }, deps());
    expect(result.envelope).toMatchObject({
      id: 'id1',
      title: 'Offer letter',
      status: 'draft',
      routing: 'sequential',
      reminders: DEFAULT_REMINDERS,
      createdAt: T0,
      documents: [],
      recipients: [],
      fields: [],
      values: [],
    });
    expect(result.events).toEqual([
      { envelopeId: 'id1', action: 'envelope.created', at: T0, data: { routing: 'sequential' } },
    ]);
    expect(result.effects).toEqual([]);
  });

  it('keeps optional settings', () => {
    const { envelope } = createEnvelope(
      {
        title: 'NDA',
        routing: 'parallel',
        message: 'Please sign',
        expiresAt: at(7),
        metadata: { employeeId: 'E1' },
      },
      deps(),
    );
    expect(envelope).toMatchObject({
      routing: 'parallel',
      message: 'Please sign',
      expiresAt: at(7),
      metadata: { employeeId: 'E1' },
    });
  });

  it('rejects a blank title, a past expiry and bad reminders', () => {
    expect(issuePaths(() => createEnvelope({ title: ' ' }, deps()))).toEqual(['title']);
    expect(issuePaths(() => createEnvelope({ title: 'x', expiresAt: at(-1) }, deps()))).toEqual([
      'expiresAt',
    ]);
    expect(issuePaths(() => createEnvelope({ title: 'x', expiresAt: 'soon' }, deps()))).toEqual([
      'expiresAt',
    ]);
    expect(
      issuePaths(() =>
        createEnvelope(
          { title: 'x', reminders: { firstAfterDays: -1, everyDays: 1, max: 1 } },
          deps(),
        ),
      ),
    ).toEqual(['reminders.firstAfterDays']);
  });
});

describe('updateEnvelope', () => {
  it('changes settings on a draft', () => {
    const { envelope } = draft();
    const next = updateEnvelope(envelope, { title: ' New ', routing: 'parallel' }, deps());
    expect(next).toMatchObject({ title: 'New', routing: 'parallel' });
    expect(envelope.title).toBe('Offer letter');
  });

  it('validates the patch', () => {
    const { envelope } = draft();
    expect(issuePaths(() => updateEnvelope(envelope, { expiresAt: at(-1) }, deps()))).toEqual([
      'expiresAt',
    ]);
  });
});

describe('addDocument', () => {
  it('adds a document with page sizes', () => {
    const { envelope } = draft();
    expect(envelope.documents).toHaveLength(1);
    expect(envelope.documents[0]).toMatchObject({ name: 'offer.pdf', pageCount: 2 });
  });

  it('rejects bad documents with a path per problem', () => {
    const { envelope, ids } = draft();
    const paths = issuePaths(() =>
      addDocument(envelope, { name: '', sha256: 'XYZ', pageCount: 0, fileKey: '' }, { ids }),
    );
    expect(paths).toEqual([
      'document.name',
      'document.sha256',
      'document.pageCount',
      'document.fileKey',
    ]);
  });

  it('requires one page size per page', () => {
    const { envelope, ids } = draft();
    const input = {
      name: 'a.pdf',
      sha256: SHA,
      pageCount: 2,
      fileKey: 'k',
      pageSizes: [{ width: 1, height: 1 }],
    };
    expect(issuePaths(() => addDocument(envelope, input, { ids }))).toEqual(['document.pageSizes']);
  });

  it('removes a document together with its fields', () => {
    const { envelope, documentId } = ready();
    const next = removeDocument(envelope, documentId);
    expect(next.documents).toEqual([]);
    expect(next.fields).toEqual([]);
    expect(errorCode(() => removeDocument(next, documentId))).toBe('VALIDATION');
  });
});

describe('addRecipient', () => {
  it('defaults role, auth and the next order', () => {
    const { envelope, ids } = draft();
    const a = addRecipient(envelope, { name: 'Asha', email: ' asha@example.com ' }, { ids });
    const b = addRecipient(a.envelope, { name: 'Ravi', phone: '+91 98765-43210' }, { ids });
    const c = addRecipient(
      b.envelope,
      { name: 'HR', email: 'hr@example.com', role: 'viewer' },
      { ids },
    );
    expect(a.recipient).toMatchObject({
      role: 'signer',
      order: 1,
      auth: 'email_otp',
      status: 'pending',
      email: 'asha@example.com',
    });
    expect(b.recipient).toMatchObject({ order: 2, auth: 'sms_otp', phone: '+919876543210' });
    expect(c.recipient).toMatchObject({ role: 'viewer', order: 1 });
    const d = addRecipient(
      c.envelope,
      { name: 'Lead', email: 'lead@example.com', role: 'approver' },
      { ids },
    );
    expect(d.recipient.order).toBe(3);
  });

  it('keeps an explicit order so recipients can share one', () => {
    const { envelope, ids } = draft();
    const a = addRecipient(envelope, { name: 'A', email: 'a@example.com', order: 1 }, { ids });
    const b = addRecipient(a.envelope, { name: 'B', email: 'b@example.com', order: 1 }, { ids });
    expect(b.recipient.order).toBe(1);
  });

  it('rejects malformed contacts and orders below 1', () => {
    const { envelope, ids } = draft();
    expect(
      issuePaths(() => addRecipient(envelope, { name: 'A', email: 'not-an-email' }, { ids })),
    ).toContain('recipient.email');
    expect(
      issuePaths(() => addRecipient(envelope, { name: 'A', phone: '12345' }, { ids })),
    ).toContain('recipient.phone');
    expect(
      issuePaths(() =>
        addRecipient(envelope, { name: 'A', email: 'a@example.com', order: 0 }, { ids }),
      ),
    ).toEqual(['recipient.order']);
    expect(issuePaths(() => addRecipient(envelope, { name: 'A' }, { ids }))).toContain(
      'recipient.email',
    );
  });
});

describe('updateRecipient', () => {
  it('updates and clears contact details', () => {
    const { envelope, ids } = ready({
      recipients: [{ name: 'Asha', email: 'asha@example.com', phone: '+919876543210' }],
    });
    const next = updateRecipient(envelope, ids[0]!, { name: 'Asha K', phone: '' });
    expect(next.recipients[0]).toMatchObject({ name: 'Asha K', email: 'asha@example.com' });
    expect(next.recipients[0]!.phone).toBeUndefined();
  });

  it('validates the result', () => {
    const { envelope, ids } = ready();
    expect(issuePaths(() => updateRecipient(envelope, ids[0]!, { auth: 'sms_otp' }))).toEqual([
      `recipients.${ids[0]}.phone`,
    ]);
    expect(issuePaths(() => updateRecipient(envelope, ids[0]!, { email: 'bad' }))).toContain(
      `recipients.${ids[0]}.email`,
    );
  });

  it('refuses to turn a recipient with fields into a viewer', () => {
    const { envelope, ids } = ready();
    expect(issuePaths(() => updateRecipient(envelope, ids[0]!, { role: 'viewer' }))).toEqual([
      `recipients.${ids[0]}.role`,
    ]);
  });

  it('reports unknown recipients', () => {
    const { envelope } = ready();
    expect(errorCode(() => updateRecipient(envelope, 'nope', { name: 'x' }))).toBe(
      'RECIPIENT_NOT_FOUND',
    );
    expect(errorCode(() => removeRecipient(envelope, 'nope'))).toBe('RECIPIENT_NOT_FOUND');
  });

  it('removes a recipient with their fields', () => {
    const { envelope, ids } = ready();
    const next = removeRecipient(envelope, ids[0]!);
    expect(next.recipients.map((r) => r.id)).toEqual([ids[1]]);
    expect(next.fields.every((f) => f.recipientId === ids[1])).toBe(true);
  });
});

describe('fields', () => {
  it('adds a required field by default', () => {
    const { envelope, ids, documentId } = ready();
    const added = addField(
      envelope,
      { documentId, recipientId: ids[0]!, type: 'initials', page: 0, rect },
      deps(),
    );
    expect(added.field).toMatchObject({ required: true, type: 'initials', page: 0, rect });
  });

  it('keeps the box inside the page', () => {
    const { envelope, ids, documentId } = ready();
    const add = (r: typeof rect, page = 0) =>
      issuePaths(() =>
        addField(
          envelope,
          { documentId, recipientId: ids[0]!, type: 'text', page, rect: r },
          deps(),
        ),
      );
    expect(add({ x: 600, y: 10, width: 50, height: 20 })).toEqual(['field.rect']);
    expect(add({ x: 10, y: 780, width: 50, height: 20 })).toEqual(['field.rect']);
    expect(add({ x: -5, y: 10, width: 50, height: 20 })).toEqual(['field.rect']);
    expect(add(rect, 2)).toEqual(['field.page']);
    expect(add(rect, -1)).toEqual(['field.page']);
  });

  it('only gives fields to signers and approvers of this envelope', () => {
    const { envelope, documentId, ids } = ready({
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'V', email: 'v@example.com', role: 'viewer' },
        { name: 'P', email: 'p@example.com', role: 'approver' },
      ],
    });
    const add = (recipientId: string, docId = documentId) =>
      issuePaths(() =>
        addField(envelope, { documentId: docId, recipientId, type: 'text', page: 0, rect }, deps()),
      );
    expect(add(ids[1]!)).toEqual(['field.recipientId']);
    expect(add('stranger')).toEqual(['field.recipientId']);
    expect(add(ids[2]!)).toEqual([]);
    expect(add(ids[0]!, 'other-doc')).toEqual(['field.documentId']);
  });

  it('moves a field and checks the new position', () => {
    const { envelope } = ready();
    const field = envelope.fields[0]!;
    const moved = moveField(envelope, field.id, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      page: 0,
    });
    expect(moved.fields[0]).toMatchObject({ page: 0, rect: { x: 0, y: 0, width: 10, height: 10 } });
    expect(
      issuePaths(() =>
        moveField(envelope, field.id, { rect: { x: 0, y: 0, width: 1000, height: 10 } }),
      ),
    ).toEqual([`fields.${field.id}.rect`]);
    expect(errorCode(() => moveField(envelope, 'nope', { rect }))).toBe('VALIDATION');
  });

  it('removes a field', () => {
    const { envelope } = ready();
    const next = removeField(envelope, envelope.fields[0]!.id);
    expect(next.fields).toHaveLength(envelope.fields.length - 1);
    expect(errorCode(() => removeField(next, envelope.fields[0]!.id))).toBe('VALIDATION');
  });
});

describe('validateForSend', () => {
  it('is empty for a ready envelope', () => {
    expect(validateForSend(ready().envelope, now)).toEqual([]);
  });

  it('lists everything missing from an empty draft', () => {
    const { envelope } = createEnvelope({ title: 'x' }, deps());
    expect(validateForSend(envelope, now).map((i) => i.path)).toEqual(['documents', 'recipients']);
  });

  it('needs a required signature field for every signer', () => {
    const { envelope, ids } = ready();
    const withoutSignature = {
      ...envelope,
      fields: envelope.fields.filter((f) => !(f.recipientId === ids[1] && f.type === 'signature')),
    };
    expect(validateForSend(withoutSignature, now).map((i) => i.path)).toEqual([
      `recipients.${ids[1]}.fields`,
    ]);
    const optional = {
      ...envelope,
      fields: envelope.fields.map((f) =>
        f.recipientId === ids[0] && f.type === 'signature' ? { ...f, required: false } : f,
      ),
    };
    expect(validateForSend(optional, now).map((i) => i.path)).toEqual([
      `recipients.${ids[0]}.fields`,
    ]);
  });

  it('does not ask approvers or viewers for a signature', () => {
    const { envelope } = ready({
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'P', email: 'p@example.com', role: 'approver' },
        { name: 'V', email: 'v@example.com', role: 'viewer' },
      ],
    });
    expect(validateForSend(envelope, now)).toEqual([]);
  });

  it('needs at least one signer or approver', () => {
    const { envelope } = ready({
      recipients: [{ name: 'V', email: 'v@example.com', role: 'viewer' }],
    });
    expect(validateForSend(envelope, now).map((i) => i.path)).toEqual(['recipients']);
  });

  it('rejects an expiry that has passed by send time', () => {
    const { envelope } = ready({ expiresAt: at(1) });
    expect(validateForSend(envelope, new Date(at(2))).map((i) => i.path)).toEqual(['expiresAt']);
  });

  it('throws a validation error listing every issue', () => {
    const { envelope } = createEnvelope({ title: 'x' }, deps());
    expect(issuePaths(() => assertReadyToSend(envelope, now))).toEqual(['documents', 'recipients']);
  });
});

describe('draft only', () => {
  it('refuses edits once the envelope has left draft', () => {
    const { envelope, ids, documentId } = ready();
    const sent = { ...envelope, status: 'sent' as const };
    const d = deps();
    expect(errorCode(() => updateEnvelope(sent, { title: 'x' }, { clock: clockAt(T0) }))).toBe(
      'INVALID_STATE',
    );
    expect(
      errorCode(() => addDocument(sent, { name: 'a', sha256: SHA, pageCount: 1, fileKey: 'k' }, d)),
    ).toBe('INVALID_STATE');
    expect(errorCode(() => addRecipient(sent, { name: 'A', email: 'a@example.com' }, d))).toBe(
      'INVALID_STATE',
    );
    expect(errorCode(() => updateRecipient(sent, ids[0]!, { name: 'B' }))).toBe('INVALID_STATE');
    expect(errorCode(() => removeRecipient(sent, ids[0]!))).toBe('INVALID_STATE');
    expect(
      errorCode(() =>
        addField(sent, { documentId, recipientId: ids[0]!, type: 'text', page: 0, rect }, d),
      ),
    ).toBe('INVALID_STATE');
    expect(errorCode(() => moveField(sent, sent.fields[0]!.id, { rect }))).toBe('INVALID_STATE');
    expect(errorCode(() => removeField(sent, sent.fields[0]!.id))).toBe('INVALID_STATE');
    expect(errorCode(() => removeDocument(sent, documentId))).toBe('INVALID_STATE');
  });

  it('never mutates its input', () => {
    const { envelope, ids } = ready();
    const snapshot = JSON.stringify(envelope);
    updateRecipient(envelope, ids[0]!, { name: 'Changed' });
    moveField(envelope, envelope.fields[0]!.id, { rect });
    removeRecipient(envelope, ids[0]!);
    expect(JSON.stringify(envelope)).toBe(snapshot);
  });
});
