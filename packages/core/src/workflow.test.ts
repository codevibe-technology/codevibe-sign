import { describe, expect, it } from 'vitest';
import { addField } from './builder';
import { currentRecipients, isFinal } from './routing';
import {
  at,
  clockAt,
  errorCode,
  PNG,
  ready,
  T0,
  valuesFor,
  type ReadyOptions,
} from './test/fixtures';
import type { Envelope, TransitionResult } from './types';
import { SignError } from './types';
import {
  decline,
  markAuthenticated,
  markViewed,
  MIN_REMINDER_INTERVAL_MS,
  recordSeal,
  remind,
  send,
  submit,
  voidEnvelope,
} from './workflow';

const d = (iso = T0) => ({ clock: clockAt(iso) });

function sent(options: ReadyOptions = {}) {
  const r = ready(options);
  return { ...r, envelope: send(r.envelope, d()).envelope };
}

const sign = (envelope: Envelope, recipientId: string, iso = T0) =>
  submit(envelope, { recipientId, values: valuesFor(envelope, recipientId) }, d(iso));

const ids = (result: TransitionResult, reason: string) =>
  result.effects.flatMap((e) =>
    e.kind === 'notify' && e.reason === reason ? [e.recipientId] : [],
  );

const actions = (result: TransitionResult) => result.events.map((e) => e.action);

function thrown(fn: () => unknown): SignError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SignError) return error;
    throw error;
  }
  throw new Error('expected a SignError');
}

const parallelThree: ReadyOptions = {
  routing: 'parallel',
  recipients: [
    { name: 'A', email: 'a@example.com' },
    { name: 'B', email: 'b@example.com' },
    { name: 'C', email: 'c@example.com' },
  ],
};

describe('send', () => {
  it('sends a sequential envelope and invites only the first signer', () => {
    const {
      envelope,
      ids: [a, b],
    } = ready();
    const result = send(envelope, d(), { context: { ip: '10.0.0.1' } });
    expect(result.envelope).toMatchObject({ status: 'sent', sentAt: T0 });
    expect(result.envelope.recipients.map((r) => r.status)).toEqual(['notified', 'pending']);
    expect(result.envelope.recipients[0]!.notifiedAt).toBe(T0);
    expect(actions(result)).toEqual(['envelope.sent', 'recipient.notified']);
    expect(result.events[0]!.context).toEqual({ ip: '10.0.0.1' });
    expect(ids(result, 'invite')).toEqual([a]);
    expect(ids(result, 'invite')).not.toContain(b);
    expect(result.effects.filter((e) => e.kind === 'webhook')).toEqual([
      { kind: 'webhook', event: 'envelope.sent', envelopeId: envelope.id },
      { kind: 'webhook', event: 'recipient.notified', envelopeId: envelope.id },
    ]);
  });

  it('invites every signer and approver at once in parallel, but not viewers', () => {
    const {
      envelope,
      ids: [a, b, v],
    } = ready({
      routing: 'parallel',
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'B', email: 'b@example.com', role: 'approver' },
        { name: 'V', email: 'v@example.com', role: 'viewer' },
      ],
    });
    const result = send(envelope, d());
    expect(ids(result, 'invite')).toEqual([a, b]);
    expect(result.envelope.recipients.find((r) => r.id === v)!.status).toBe('pending');
  });

  it('invites everyone who shares the lowest order', () => {
    const {
      envelope,
      ids: [a, b, c],
    } = ready({
      recipients: [
        { name: 'A', email: 'a@example.com', order: 1 },
        { name: 'B', email: 'b@example.com', order: 1 },
        { name: 'C', email: 'c@example.com', order: 2 },
      ],
    });
    const result = send(envelope, d());
    expect(ids(result, 'invite')).toEqual([a, b]);
    expect(ids(result, 'invite')).not.toContain(c);
  });

  it('refuses an envelope that is not ready', () => {
    const { envelope } = ready();
    const error = thrown(() => send({ ...envelope, fields: [] }, d()));
    expect(error.code).toBe('VALIDATION');
    expect(error.details?.issues).toHaveLength(2);
  });

  it('refuses to send twice', () => {
    const { envelope } = sent();
    expect(errorCode(() => send(envelope, d()))).toBe('INVALID_STATE');
  });

  it('does not mutate the draft', () => {
    const { envelope } = ready();
    const snapshot = JSON.stringify(envelope);
    send(envelope, d());
    expect(JSON.stringify(envelope)).toBe(snapshot);
  });
});

describe('sequential routing', () => {
  it('moves to the next signer after each signature and completes after the last', () => {
    const {
      envelope,
      ids: [a, b],
    } = sent();
    const first = sign(envelope, a!, at(1));
    expect(first.envelope.status).toBe('in_progress');
    expect(first.envelope.recipients.map((r) => r.status)).toEqual(['signed', 'notified']);
    expect(actions(first)).toEqual(['recipient.signed', 'recipient.notified']);
    expect(ids(first, 'invite')).toEqual([b]);
    expect(currentRecipients(first.envelope).map((r) => r.id)).toEqual([b]);

    const second = sign(first.envelope, b!, at(2));
    expect(second.envelope).toMatchObject({ status: 'completed', completedAt: at(2) });
    expect(isFinal(second.envelope)).toBe(true);
    expect(actions(second)).toEqual(['recipient.signed', 'envelope.completed']);
  });

  it('refuses a signer whose turn has not come', () => {
    const {
      envelope,
      ids: [, b],
    } = sent();
    expect(errorCode(() => sign(envelope, b!))).toBe('NOT_YOUR_TURN');
    expect(errorCode(() => markViewed(envelope, { recipientId: b! }, d()))).toBe('NOT_YOUR_TURN');
    expect(errorCode(() => markAuthenticated(envelope, { recipientId: b! }, d()))).toBe(
      'NOT_YOUR_TURN',
    );
    expect(errorCode(() => decline(envelope, { recipientId: b!, reason: 'no' }, d()))).toBe(
      'NOT_YOUR_TURN',
    );
  });

  it('waits for every member of an equal-order group before moving on', () => {
    const {
      envelope,
      ids: [a, b, c],
    } = sent({
      recipients: [
        { name: 'A', email: 'a@example.com', order: 1 },
        { name: 'B', email: 'b@example.com', order: 1 },
        { name: 'C', email: 'c@example.com', order: 2 },
      ],
    });
    const afterB = sign(envelope, b!);
    expect(ids(afterB, 'invite')).toEqual([]);
    expect(errorCode(() => sign(afterB.envelope, c!))).toBe('NOT_YOUR_TURN');
    const afterA = sign(afterB.envelope, a!);
    expect(ids(afterA, 'invite')).toEqual([c]);
    expect(sign(afterA.envelope, c!).envelope.status).toBe('completed');
  });

  it('respects orders that skip numbers and are added out of sequence', () => {
    const {
      envelope,
      ids: [late, early],
    } = sent({
      recipients: [
        { name: 'Late', email: 'l@example.com', order: 10 },
        { name: 'Early', email: 'e@example.com', order: 3 },
      ],
    });
    expect(currentRecipients(envelope).map((r) => r.id)).toEqual([early]);
    const next = sign(envelope, early!);
    expect(ids(next, 'invite')).toEqual([late]);
  });

  it('routes approvers in order like signers', () => {
    const {
      envelope,
      ids: [approver, signer],
    } = sent({
      recipients: [
        { name: 'Manager', email: 'm@example.com', role: 'approver' },
        { name: 'Asha', email: 'a@example.com' },
      ],
    });
    const approved = submit(envelope, { recipientId: approver!, values: [] }, d());
    expect(approved.envelope.recipients[0]!.status).toBe('approved');
    expect(actions(approved)).toEqual(['recipient.approved', 'recipient.notified']);
    expect(ids(approved, 'invite')).toEqual([signer]);
  });
});

describe('parallel routing', () => {
  it('lets anyone sign in any order', () => {
    const {
      envelope,
      ids: [a, b, c],
    } = sent(parallelThree);
    const r1 = sign(envelope, c!);
    expect(ids(r1, 'invite')).toEqual([]);
    const r2 = sign(r1.envelope, a!);
    expect(r2.envelope.status).toBe('in_progress');
    const r3 = sign(r2.envelope, b!);
    expect(r3.envelope.status).toBe('completed');
  });

  it('ignores order numbers', () => {
    const { envelope } = sent({
      routing: 'parallel',
      recipients: [
        { name: 'A', email: 'a@example.com', order: 1 },
        { name: 'B', email: 'b@example.com', order: 5 },
      ],
    });
    expect(currentRecipients(envelope)).toHaveLength(2);
  });
});

describe('completion', () => {
  it('seals and sends a completed copy to everyone, viewers included', () => {
    const {
      envelope,
      ids: [a, v],
    } = sent({
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'V', email: 'v@example.com', role: 'viewer' },
      ],
    });
    const result = sign(envelope, a!);
    expect(result.envelope.status).toBe('completed');
    expect(result.effects).toContainEqual({ kind: 'seal', envelopeId: envelope.id });
    expect(ids(result, 'completed_copy')).toEqual([a, v]);
    expect(result.effects.at(-1)).toEqual({
      kind: 'webhook',
      event: 'envelope.completed',
      envelopeId: envelope.id,
    });
  });

  it('refuses further actions once completed', () => {
    const {
      envelope,
      ids: [a],
    } = sent({ recipients: [{ name: 'A', email: 'a@example.com' }] });
    const done = sign(envelope, a!).envelope;
    expect(errorCode(() => sign(done, a!))).toBe('INVALID_STATE');
    expect(errorCode(() => markViewed(done, { recipientId: a! }, d()))).toBe('INVALID_STATE');
    expect(errorCode(() => decline(done, { recipientId: a!, reason: 'x' }, d()))).toBe(
      'INVALID_STATE',
    );
    expect(errorCode(() => voidEnvelope(done, { reason: 'x' }, d()))).toBe('INVALID_STATE');
  });
});

describe('submit values', () => {
  it('stores values and fills date and name fields itself', () => {
    const r = ready({ recipients: [{ name: 'Asha Rao', email: 'a@example.com' }] });
    const rect = { x: 10, y: 10, width: 80, height: 20 };
    const f = { documentId: r.documentId, recipientId: r.ids[0]!, page: 0, rect };
    let envelope = addField(r.envelope, { ...f, type: 'date_signed' }, { ids: r.gen }).envelope;
    envelope = addField(envelope, { ...f, type: 'name' }, { ids: r.gen }).envelope;
    envelope = send(envelope, d()).envelope;
    const [signature, text, date, name] = envelope.fields.map((x) => x.id);
    const result = submit(
      envelope,
      {
        recipientId: r.ids[0]!,
        values: [
          { fieldId: signature!, value: `data:image/png;base64,${PNG}` },
          { fieldId: text!, value: ' note ' },
        ],
      },
      d(at(1)),
    );
    expect(result.envelope.values).toEqual([
      { fieldId: signature, value: PNG },
      { fieldId: text, value: 'note' },
      { fieldId: date, value: at(1) },
      { fieldId: name, value: 'Asha Rao' },
    ]);
    expect(result.events[0]!.data).toEqual({ fields: 4 });
  });

  it('uses the server time for date fields, whatever the signer sends', () => {
    const r = ready({ recipients: [{ name: 'A', email: 'a@example.com' }] });
    const field = addField(
      r.envelope,
      {
        documentId: r.documentId,
        recipientId: r.ids[0]!,
        page: 0,
        type: 'date_signed',
        rect: { x: 1, y: 1, width: 5, height: 5 },
      },
      { ids: r.gen },
    );
    const envelope = send(field.envelope, d()).envelope;
    const values = [
      ...valuesFor(envelope, r.ids[0]!).filter((v) => v.fieldId !== field.field.id),
      { fieldId: field.field.id, value: '2026-02-28' },
    ];
    const result = submit(envelope, { recipientId: r.ids[0]!, values }, d(at(2)));
    expect(result.envelope.values).toContainEqual({ fieldId: field.field.id, value: at(2) });
    expect(result.envelope.values).not.toContainEqual({
      fieldId: field.field.id,
      value: '2026-02-28',
    });

    const garbage = values.map((v) =>
      v.fieldId === field.field.id ? { ...v, value: 'not a date' } : v,
    );
    const ignored = submit(envelope, { recipientId: r.ids[0]!, values: garbage }, d(at(2)));
    expect(ignored.envelope.values).toContainEqual({ fieldId: field.field.id, value: at(2) });
  });

  it('requires every required field', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const error = thrown(() => submit(envelope, { recipientId: a!, values: [] }, d()));
    expect(error.code).toBe('REQUIRED_FIELDS_MISSING');
    expect(error.details?.fieldIds).toEqual([envelope.fields[0]!.id]);
  });

  it('treats an empty value as missing', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const values = [{ fieldId: envelope.fields[0]!.id, value: '' }];
    expect(errorCode(() => submit(envelope, { recipientId: a!, values }, d()))).toBe(
      'INVALID_FIELD_VALUE',
    );
  });

  it('requires a required checkbox to be ticked', () => {
    const r = ready({ recipients: [{ name: 'A', email: 'a@example.com' }] });
    const box = addField(
      r.envelope,
      {
        documentId: r.documentId,
        recipientId: r.ids[0]!,
        page: 0,
        type: 'checkbox',
        rect: { x: 1, y: 1, width: 5, height: 5 },
      },
      { ids: r.gen },
    );
    const envelope = send(box.envelope, d()).envelope;
    const base = valuesFor(envelope, r.ids[0]!).filter((v) => v.fieldId !== box.field.id);
    expect(
      errorCode(() =>
        submit(
          envelope,
          { recipientId: r.ids[0]!, values: [...base, { fieldId: box.field.id, value: 'false' }] },
          d(),
        ),
      ),
    ).toBe('REQUIRED_FIELDS_MISSING');
    expect(
      submit(
        envelope,
        { recipientId: r.ids[0]!, values: [...base, { fieldId: box.field.id, value: 'true' }] },
        d(),
      ).envelope.status,
    ).toBe('completed');
  });

  it('refuses values for another recipient’s field', () => {
    const {
      envelope,
      ids: [a, b],
    } = sent(parallelThree);
    const theirs = envelope.fields.find((f) => f.recipientId === b)!;
    const values = [...valuesFor(envelope, a!), { fieldId: theirs.id, value: PNG }];
    const error = thrown(() => submit(envelope, { recipientId: a!, values }, d()));
    expect(error.code).toBe('FIELD_NOT_YOURS');
    expect(error.details).toEqual({ fieldId: theirs.id });
  });

  it('refuses unknown fields', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const values = [...valuesFor(envelope, a!), { fieldId: 'ghost', value: 'x' }];
    expect(errorCode(() => submit(envelope, { recipientId: a!, values }, d()))).toBe(
      'FIELD_NOT_YOURS',
    );
  });

  it('refuses an invalid PNG signature', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const sig = envelope.fields[0]!.id;
    const gif = btoa('GIF89a' + '\0'.repeat(40));
    const error = thrown(() =>
      submit(envelope, { recipientId: a!, values: [{ fieldId: sig, value: gif }] }, d()),
    );
    expect(error.code).toBe('INVALID_FIELD_VALUE');
    expect(error.details?.fields).toEqual([{ fieldId: sig, problem: 'Image is not a PNG' }]);
    expect(
      errorCode(() =>
        submit(envelope, { recipientId: a!, values: [{ fieldId: sig, value: 'hello' }] }, d()),
      ),
    ).toBe('INVALID_FIELD_VALUE');
  });

  it('refuses text over the length cap', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const text = envelope.fields[1]!.id;
    const values = [...valuesFor(envelope, a!), { fieldId: text, value: 'x'.repeat(1001) }];
    expect(errorCode(() => submit(envelope, { recipientId: a!, values }, d()))).toBe(
      'INVALID_FIELD_VALUE',
    );
  });

  it('refuses the same field twice', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const values = [...valuesFor(envelope, a!), ...valuesFor(envelope, a!)];
    expect(errorCode(() => submit(envelope, { recipientId: a!, values }, d()))).toBe(
      'INVALID_FIELD_VALUE',
    );
  });

  it('refuses viewers and unknown recipients', () => {
    const {
      envelope,
      ids: [, v],
    } = sent({
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'V', email: 'v@example.com', role: 'viewer' },
      ],
    });
    expect(errorCode(() => submit(envelope, { recipientId: v!, values: [] }, d()))).toBe(
      'INVALID_STATE',
    );
    expect(errorCode(() => submit(envelope, { recipientId: 'nobody', values: [] }, d()))).toBe(
      'RECIPIENT_NOT_FOUND',
    );
  });

  it('refuses a second signature from the same signer', () => {
    const {
      envelope,
      ids: [a],
    } = sent(parallelThree);
    const once = sign(envelope, a!).envelope;
    expect(errorCode(() => sign(once, a!))).toBe('INVALID_STATE');
  });

  it('refuses to act on a draft', () => {
    const {
      envelope,
      ids: [a],
    } = ready();
    expect(errorCode(() => sign(envelope, a!))).toBe('INVALID_STATE');
  });
});

describe('markViewed and markAuthenticated', () => {
  it('marks the first view and records every view', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const first = markViewed(envelope, { recipientId: a!, context: { userAgent: 'UA' } }, d(at(1)));
    expect(first.envelope.recipients[0]).toMatchObject({ status: 'viewed', viewedAt: at(1) });
    expect(first.events).toEqual([
      {
        envelopeId: envelope.id,
        action: 'recipient.viewed',
        at: at(1),
        recipientId: a,
        context: { userAgent: 'UA' },
      },
    ]);
    const again = markViewed(first.envelope, { recipientId: a! }, d(at(2)));
    expect(again.envelope.recipients[0]!.viewedAt).toBe(at(1));
    expect(actions(again)).toEqual(['recipient.viewed']);
  });

  it('lets a signer who has signed view again without changing status', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const signedOnce = sign(envelope, a!).envelope;
    const viewed = markViewed(signedOnce, { recipientId: a! }, d());
    expect(viewed.envelope.recipients[0]!.status).toBe('signed');
  });

  it('lets viewers view while the envelope is open', () => {
    const {
      envelope,
      ids: [, v],
    } = sent({
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'V', email: 'v@example.com', role: 'viewer' },
      ],
    });
    expect(markViewed(envelope, { recipientId: v! }, d()).envelope.recipients[1]!.status).toBe(
      'viewed',
    );
  });

  it('records the authentication method used', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const result = markAuthenticated(envelope, { recipientId: a!, method: 'email_otp' }, d());
    expect(result.events[0]).toMatchObject({
      action: 'recipient.authenticated',
      recipientId: a,
      data: { method: 'email_otp' },
    });
    const byDefault = markAuthenticated(envelope, { recipientId: a! }, d());
    expect(byDefault.events[0]!.data).toEqual({ method: 'email_link' });
    expect(byDefault.envelope.recipients).toEqual(envelope.recipients);
  });

  it('reports unknown recipients', () => {
    const { envelope } = sent();
    expect(errorCode(() => markViewed(envelope, { recipientId: 'x' }, d()))).toBe(
      'RECIPIENT_NOT_FOUND',
    );
  });
});

describe('decline', () => {
  it('stops the envelope for everyone', () => {
    const {
      envelope,
      ids: [a, b, c],
    } = sent(parallelThree);
    const afterA = sign(envelope, a!).envelope;
    const result = decline(
      afterA,
      { recipientId: b!, reason: '  Wrong salary  ', context: { ip: '1.1.1.1' } },
      d(at(1)),
    );
    expect(result.envelope.status).toBe('declined');
    expect(isFinal(result.envelope)).toBe(true);
    expect(result.envelope.recipients.find((r) => r.id === b)).toMatchObject({
      status: 'declined',
      declineReason: 'Wrong salary',
      actedAt: at(1),
    });
    expect(actions(result)).toEqual(['recipient.declined', 'envelope.declined']);
    expect(result.events[0]!.data).toEqual({ reason: 'Wrong salary' });
    expect(ids(result, 'cancelled')).toEqual([a, c]);
    expect(result.effects.some((e) => e.kind === 'seal')).toBe(false);
    expect(currentRecipients(result.envelope)).toEqual([]);
    expect(errorCode(() => sign(result.envelope, c!))).toBe('INVALID_STATE');
  });

  it('does not tell recipients who were never invited', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const result = decline(envelope, { recipientId: a!, reason: 'No' }, d());
    expect(ids(result, 'cancelled')).toEqual([]);
  });

  it('requires a reason', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const error = thrown(() => decline(envelope, { recipientId: a!, reason: '   ' }, d()));
    expect(error.code).toBe('VALIDATION');
    expect(error.details?.issues).toEqual([{ path: 'reason', message: 'A reason is required' }]);
    expect(
      errorCode(() => decline(envelope, { recipientId: a!, reason: 'x'.repeat(1001) }, d())),
    ).toBe('VALIDATION');
  });

  it('refuses viewers and recipients who already acted', () => {
    const {
      envelope,
      ids: [a, , v],
    } = sent({
      routing: 'parallel',
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'B', email: 'b@example.com' },
        { name: 'V', email: 'v@example.com', role: 'viewer' },
      ],
    });
    expect(errorCode(() => decline(envelope, { recipientId: v!, reason: 'x' }, d()))).toBe(
      'INVALID_STATE',
    );
    const signedA = sign(envelope, a!).envelope;
    expect(errorCode(() => decline(signedA, { recipientId: a!, reason: 'x' }, d()))).toBe(
      'INVALID_STATE',
    );
  });
});

describe('voidEnvelope', () => {
  it('voids a sent envelope and tells invited recipients', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const result = voidEnvelope(
      envelope,
      { reason: 'Sent by mistake', context: { ip: '2.2.2.2' } },
      d(),
    );
    expect(result.envelope.status).toBe('voided');
    expect(result.events).toEqual([
      {
        envelopeId: envelope.id,
        action: 'envelope.voided',
        at: T0,
        context: { ip: '2.2.2.2' },
        data: { reason: 'Sent by mistake' },
      },
    ]);
    expect(ids(result, 'cancelled')).toEqual([a]);
  });

  it('voids a draft without notifying anyone', () => {
    const { envelope } = ready();
    const result = voidEnvelope(envelope, { reason: 'Not needed' }, d());
    expect(result.envelope.status).toBe('voided');
    expect(ids(result, 'cancelled')).toEqual([]);
  });

  it('requires a reason and refuses final envelopes', () => {
    const { envelope } = sent();
    expect(errorCode(() => voidEnvelope(envelope, { reason: '' }, d()))).toBe('VALIDATION');
    const voided = voidEnvelope(envelope, { reason: 'x' }, d()).envelope;
    expect(errorCode(() => voidEnvelope(voided, { reason: 'x' }, d()))).toBe('INVALID_STATE');
  });

  it('stops signing', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const voided = voidEnvelope(envelope, { reason: 'x' }, d()).envelope;
    expect(errorCode(() => sign(voided, a!))).toBe('INVALID_STATE');
  });
});

describe('remind', () => {
  const later = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

  it('reminds whoever is current with a fresh link, without using up automatic reminders', () => {
    const {
      envelope,
      ids: [a],
    } = sent();
    const result = remind(envelope, { context: { ip: '3.3.3.3' } }, d(later(20)));
    expect(ids(result, 'reminder')).toEqual([a]);
    expect(result.events).toEqual([
      {
        envelopeId: envelope.id,
        action: 'recipient.reminded',
        at: later(20),
        recipientId: a,
        context: { ip: '3.3.3.3' },
        data: { manual: true },
      },
    ]);
    const asha = result.envelope.recipients.find((r) => r.id === a)!;
    expect(asha.lastRemindedAt).toBe(later(20));
    expect(asha.remindersSent).toBeUndefined();
  });

  it('waits between reminders to the same person', () => {
    const { envelope } = sent();
    expect(MIN_REMINDER_INTERVAL_MS).toBe(15 * 60_000);
    expect(thrown(() => remind(envelope, {}, d(later(5)))).message).toMatch(/15 minutes/);
    const once = remind(envelope, {}, d(later(15))).envelope;
    expect(errorCode(() => remind(once, {}, d(later(20))))).toBe('INVALID_STATE');
    expect(actions(remind(once, {}, d(later(31))))).toEqual(['recipient.reminded']);
  });

  it('reminds only the people whose turn it is, skipping those reminded recently', () => {
    const {
      envelope,
      ids: [a, b, c],
    } = sent(parallelThree);
    const first = remind(envelope, { recipientId: b! }, d(later(20))).envelope;
    const all = remind(first, {}, d(later(25)));
    expect(ids(all, 'reminder')).toEqual([a, c]);
  });

  it('refuses recipients who are not due', () => {
    const {
      envelope,
      ids: [a, b],
    } = sent();
    expect(errorCode(() => remind(envelope, { recipientId: b! }, d(later(20))))).toBe(
      'NOT_YOUR_TURN',
    );
    expect(errorCode(() => remind(envelope, { recipientId: 'nobody' }, d(later(20))))).toBe(
      'RECIPIENT_NOT_FOUND',
    );
    const signed = sign(envelope, a!).envelope;
    expect(errorCode(() => remind(signed, { recipientId: a! }, d(later(20))))).toBe(
      'INVALID_STATE',
    );
  });

  it('refuses drafts, final and expired envelopes', () => {
    const { envelope: draftEnvelope } = ready();
    expect(errorCode(() => remind(draftEnvelope, {}, d()))).toBe('INVALID_STATE');
    const { envelope } = sent({ expiresAt: at(5) });
    expect(errorCode(() => remind(envelope, {}, d(at(6))))).toBe('ENVELOPE_EXPIRED');
    const voided = voidEnvelope(envelope, { reason: 'x' }, d()).envelope;
    expect(errorCode(() => remind(voided, {}, d(later(20))))).toBe('INVALID_STATE');
  });
});

describe('expiry during signing', () => {
  it('refuses actions at and after the expiry time', () => {
    const {
      envelope,
      ids: [a],
    } = sent({ expiresAt: at(5) });
    expect(errorCode(() => sign(envelope, a!, at(5)))).toBe('ENVELOPE_EXPIRED');
    expect(errorCode(() => markViewed(envelope, { recipientId: a! }, d(at(6))))).toBe(
      'ENVELOPE_EXPIRED',
    );
    expect(errorCode(() => decline(envelope, { recipientId: a!, reason: 'x' }, d(at(6))))).toBe(
      'ENVELOPE_EXPIRED',
    );
    expect(sign(envelope, a!, at(4.9)).envelope.status).toBe('in_progress');
  });

  it('refuses the second signer once the envelope expires midway', () => {
    const {
      envelope,
      ids: [a, b],
    } = sent({ expiresAt: at(5) });
    const afterA = sign(envelope, a!, at(1)).envelope;
    expect(errorCode(() => sign(afterA, b!, at(6)))).toBe('ENVELOPE_EXPIRED');
  });
});

describe('recordSeal', () => {
  it('records the sealed hash on a completed envelope', () => {
    const {
      envelope,
      ids: [a],
      documentId,
    } = sent({ recipients: [{ name: 'A', email: 'a@example.com' }] });
    const done = sign(envelope, a!).envelope;
    const result = recordSeal(done, { documentId, sha256: 'b'.repeat(64) }, d());
    expect(result.events[0]).toMatchObject({
      action: 'document.sealed',
      data: { documentId, sha256: 'b'.repeat(64) },
    });
    expect(result.effects).toEqual([
      { kind: 'webhook', event: 'document.sealed', envelopeId: envelope.id },
    ]);
  });

  it('refuses open envelopes and bad input', () => {
    const {
      envelope,
      ids: [a],
      documentId,
    } = sent({ recipients: [{ name: 'A', email: 'a@example.com' }] });
    expect(errorCode(() => recordSeal(envelope, { documentId, sha256: 'b'.repeat(64) }, d()))).toBe(
      'INVALID_STATE',
    );
    const done = sign(envelope, a!).envelope;
    expect(
      errorCode(() => recordSeal(done, { documentId: 'x', sha256: 'b'.repeat(64) }, d())),
    ).toBe('VALIDATION');
    expect(errorCode(() => recordSeal(done, { documentId, sha256: 'B' }, d()))).toBe('VALIDATION');
  });
});
