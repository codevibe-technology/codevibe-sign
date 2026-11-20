import { describe, expect, it } from 'vitest';
import { recallCopy } from './recall';
import { at, clockAt, counterIds, errorCode, ready, T0, valuesFor } from './test/fixtures';
import {
  correctRecipient,
  recall,
  RECALL_REASON,
  send,
  shareLink,
  submit,
  voidEnvelope,
} from './workflow';

const d = (iso = T0) => ({ clock: clockAt(iso) });

function sent(options: Parameters<typeof ready>[0] = {}) {
  const r = ready({ expiresAt: at(14), ...options });
  return { ...r, envelope: send(r.envelope, d()).envelope };
}

const notified = (result: { effects: { kind: string; recipientId?: string; reason?: string }[] }) =>
  result.effects.filter((e) => e.kind === 'notify').map((e) => [e.recipientId, e.reason]);

describe('shareLink', () => {
  it('records the share for the recipient whose turn it is, with who took it and no email', () => {
    const { envelope, ids } = sent();
    const result = shareLink(envelope, { recipientId: ids[0]!, by: 'Meera (admin)' }, d());
    expect(result.events).toEqual([
      expect.objectContaining({
        action: 'recipient.link_shared',
        recipientId: ids[0],
        data: { by: 'Meera (admin)' },
      }),
    ]);
    expect(notified(result)).toEqual([]);
    expect(result.effects).toContainEqual({
      kind: 'webhook',
      event: 'recipient.link_shared',
      envelopeId: envelope.id,
    });
  });

  it('is refused for someone not yet due, someone who acted, and a final envelope', () => {
    const { envelope, ids } = sent();
    expect(errorCode(() => shareLink(envelope, { recipientId: ids[1]! }, d()))).toBe(
      'NOT_YOUR_TURN',
    );
    const signed = submit(
      envelope,
      { recipientId: ids[0]!, values: valuesFor(envelope, ids[0]!) },
      d(),
    ).envelope;
    expect(errorCode(() => shareLink(signed, { recipientId: ids[0]! }, d()))).toBe('INVALID_STATE');
    const voided = voidEnvelope(envelope, { reason: 'x' }, d()).envelope;
    expect(errorCode(() => shareLink(voided, { recipientId: ids[0]! }, d()))).toBe('INVALID_STATE');
    expect(errorCode(() => shareLink(envelope, { recipientId: 'nobody' }, d()))).toBe(
      'RECIPIENT_NOT_FOUND',
    );
  });
});

describe('correctRecipient', () => {
  it('changes the address of the current signer, starts them over and invites them again', () => {
    const { envelope, ids } = sent();
    const later = at(1);
    const result = correctRecipient(
      envelope,
      ids[0]!,
      { email: ' Asha.Rao@Example.com ', by: 'Meera' },
      d(later),
    );
    const asha = result.envelope.recipients.find((r) => r.id === ids[0])!;
    expect(asha).toMatchObject({
      email: 'asha.rao@example.com',
      status: 'notified',
      notifiedAt: later,
      role: 'signer',
      order: 1,
    });
    expect(result.envelope.fields).toEqual(envelope.fields);
    expect(result.events[0]).toMatchObject({
      action: 'recipient.corrected',
      recipientId: ids[0],
      data: {
        oldEmail: 'asha@example.com',
        newEmail: 'asha.rao@example.com',
        invited: true,
        by: 'Meera',
      },
    });
    expect(notified(result)).toEqual([[ids[0], 'invite']]);
  });

  it('only renames, without an email, unless asked to invite again', () => {
    const { envelope, ids } = sent();
    const renamed = correctRecipient(envelope, ids[0]!, { name: 'Asha Rao' }, d());
    expect(renamed.events[0]!.data).toEqual({
      invited: false,
      oldName: 'Asha',
      newName: 'Asha Rao',
    });
    expect(notified(renamed)).toEqual([]);
    const resent = correctRecipient(envelope, ids[0]!, { name: 'Asha Rao', resend: true }, d());
    expect(notified(resent)).toEqual([[ids[0], 'invite']]);
  });

  it('changes a later signer without inviting them before their turn', () => {
    const { envelope, ids } = sent();
    const result = correctRecipient(envelope, ids[1]!, { email: 'ravi.k@example.com' }, d());
    expect(result.envelope.recipients[1]).toMatchObject({
      email: 'ravi.k@example.com',
      status: 'pending',
    });
    expect(notified(result)).toEqual([]);
  });

  it('is refused for someone who acted, on a draft or final envelope, and for bad input', () => {
    const r = ready();
    expect(errorCode(() => correctRecipient(r.envelope, r.ids[0]!, { name: 'X' }, d()))).toBe(
      'INVALID_STATE',
    );
    const { envelope, ids } = sent();
    const signed = submit(
      envelope,
      { recipientId: ids[0]!, values: valuesFor(envelope, ids[0]!) },
      d(),
    ).envelope;
    expect(() => correctRecipient(signed, ids[0]!, { name: 'X' }, d())).toThrow(
      /Recall the envelope/,
    );
    const voided = voidEnvelope(envelope, { reason: 'x' }, d()).envelope;
    expect(errorCode(() => correctRecipient(voided, ids[0]!, { name: 'X' }, d()))).toBe(
      'INVALID_STATE',
    );
    expect(
      errorCode(() => correctRecipient(envelope, ids[0]!, { email: 'not-an-email' }, d())),
    ).toBe('VALIDATION');
    expect(errorCode(() => correctRecipient(envelope, ids[0]!, { email: '' }, d()))).toBe(
      'VALIDATION',
    );
    expect(errorCode(() => correctRecipient(envelope, ids[0]!, { name: 'Asha' }, d()))).toBe(
      'VALIDATION',
    );
  });
});

describe('recall', () => {
  it('voids with the recall reason and points at the replacement', () => {
    const { envelope } = sent();
    const result = recall(
      envelope,
      {
        replacementId: 'env_new',
        replacementTitle: 'Offer letter',
        note: 'Wrong salary',
        by: 'Meera',
      },
      d(),
    );
    expect(result.envelope.status).toBe('voided');
    expect(result.events.map((e) => [e.action, e.data])).toEqual([
      ['envelope.voided', { reason: `${RECALL_REASON}: Wrong salary` }],
      [
        'envelope.recalled',
        { replacementId: 'env_new', replacementTitle: 'Offer letter', by: 'Meera' },
      ],
    ]);
    expect(notified(result).map(([, reason]) => reason)).toEqual(['cancelled']);
  });

  it('is only for sent envelopes', () => {
    const r = ready();
    expect(errorCode(() => recall(r.envelope, { replacementId: 'x' }, d()))).toBe('INVALID_STATE');
    const voided = voidEnvelope(sent().envelope, { reason: 'x' }, d()).envelope;
    expect(errorCode(() => recall(voided, { replacementId: 'x' }, d()))).toBe('INVALID_STATE');
  });
});

describe('recallCopy', () => {
  it('copies documents, recipients and fields into a fresh draft without signatures', () => {
    const { envelope, ids } = sent({
      recipients: [
        { name: 'Asha', email: 'asha@example.com', auth: 'email_otp' },
        { name: 'Ravi', email: 'ravi@example.com', role: 'approver' },
        { name: 'HR', email: 'hr@example.com', role: 'viewer' },
      ],
    });
    const signed = submit(
      envelope,
      { recipientId: ids[0]!, values: valuesFor(envelope, ids[0]!) },
      d(),
    ).envelope;
    const later = at(2);
    const copy = recallCopy(
      { ...signed, message: 'Please sign' },
      { clock: clockAt(later), ids: counterIds('copy') },
      { fileKey: (id, i) => `envelopes/${id}/documents/${i}/original.pdf`, by: 'Meera' },
    );
    const draft = copy.envelope;
    expect(draft.status).toBe('draft');
    expect(draft.id).not.toBe(envelope.id);
    expect(draft).toMatchObject({
      title: 'Offer letter',
      message: 'Please sign',
      routing: 'sequential',
    });
    expect(draft.reminders).toEqual(envelope.reminders);
    expect(draft.expiresAt).toBe(at(14, later));
    expect(draft.documents[0]).toMatchObject({
      name: 'offer.pdf',
      sha256: envelope.documents[0]!.sha256,
      fileKey: `envelopes/${draft.id}/documents/0/original.pdf`,
    });
    expect(draft.recipients.map((r) => [r.name, r.role, r.order, r.auth, r.status])).toEqual(
      envelope.recipients.map((r) => [r.name, r.role, r.order, r.auth, 'pending']),
    );
    expect(draft.fields).toHaveLength(envelope.fields.length);
    expect(draft.fields.map((f) => [f.type, f.page, f.rect])).toEqual(
      envelope.fields.map((f) => [f.type, f.page, f.rect]),
    );
    expect(draft.values).toEqual([]);
    expect(copy.events).toEqual([
      expect.objectContaining({
        action: 'envelope.created',
        data: expect.objectContaining({
          recalledFrom: envelope.id,
          recalledFromTitle: 'Offer letter',
          by: 'Meera',
        }),
      }),
    ]);
  });
});
