import { describe, expect, it } from 'vitest';
import { currentRecipients, isActive, isFinal, nextReminderAt, nextTickAt } from './routing';
import { at, clockAt, errorCode, ready, T0, valuesFor, type ReadyOptions } from './test/fixtures';
import type { Envelope, TransitionResult } from './types';
import { decline, send, submit, tick, voidEnvelope } from './workflow';

const d = (iso = T0) => ({ clock: clockAt(iso) });
const sent = (options: ReadyOptions = {}) => {
  const r = ready(options);
  return { ...r, envelope: send(r.envelope, d()).envelope };
};
const reminded = (result: TransitionResult) =>
  result.effects.flatMap((e) =>
    e.kind === 'notify' && e.reason === 'reminder' ? [e.recipientId] : [],
  );

/** Ticks once a day for `days` days and returns the day numbers on which reminders went out. */
function daily(envelope: Envelope, days: number): { envelope: Envelope; reminderDays: number[] } {
  const reminderDays: number[] = [];
  let current = envelope;
  for (let day = 1; day <= days; day++) {
    const result = tick(current, new Date(at(day)));
    if (reminded(result).length > 0) reminderDays.push(day);
    current = result.envelope;
  }
  return { envelope: current, reminderDays };
}

describe('tick reminders', () => {
  it('sends the first reminder after firstAfterDays, then every everyDays, up to max', () => {
    const { envelope } = sent({ reminders: { firstAfterDays: 2, everyDays: 3, max: 3 } });
    const { envelope: after, reminderDays } = daily(envelope, 20);
    expect(reminderDays).toEqual([2, 5, 8]);
    expect(after.recipients[0]).toMatchObject({ remindersSent: 3, lastRemindedAt: at(8) });
  });

  it('records each reminder with its count', () => {
    const {
      envelope,
      ids: [a],
    } = sent({ reminders: { firstAfterDays: 1, everyDays: 1, max: 2 } });
    const first = tick(envelope, new Date(at(1)));
    expect(first.events).toEqual([
      {
        envelopeId: envelope.id,
        action: 'recipient.reminded',
        at: at(1),
        recipientId: a,
        data: { count: 1 },
      },
    ]);
    expect(first.effects).toEqual([
      { kind: 'notify', recipientId: a, reason: 'reminder' },
      { kind: 'webhook', event: 'recipient.reminded', envelopeId: envelope.id },
    ]);
    expect(tick(first.envelope, new Date(at(2))).events[0]!.data).toEqual({ count: 2 });
  });

  it('is idempotent at the same moment', () => {
    const { envelope } = sent({ reminders: { firstAfterDays: 1, everyDays: 1, max: 5 } });
    const once = tick(envelope, new Date(at(1)));
    const twice = tick(once.envelope, new Date(at(1)));
    expect(reminded(once)).toHaveLength(1);
    expect(twice.events).toEqual([]);
    expect(twice.effects).toEqual([]);
    expect(twice.envelope).toBe(once.envelope);
  });

  it('sends one reminder per tick after a long gap, not a burst', () => {
    const { envelope } = sent({ reminders: { firstAfterDays: 1, everyDays: 1, max: 5 } });
    const late = tick(envelope, new Date(at(30)));
    expect(reminded(late)).toHaveLength(1);
    expect(reminded(tick(late.envelope, new Date(at(30))))).toHaveLength(0);
    expect(reminded(tick(late.envelope, new Date(at(31))))).toHaveLength(1);
  });

  it('sends nothing before the first reminder is due', () => {
    const { envelope } = sent({ reminders: { firstAfterDays: 3, everyDays: 1, max: 1 } });
    expect(tick(envelope, new Date(at(2.99))).events).toEqual([]);
  });

  it('sends nothing when reminders are off', () => {
    expect(
      daily(sent({ reminders: { firstAfterDays: 0, everyDays: 1, max: 5 } }).envelope, 30)
        .reminderDays,
    ).toEqual([]);
    expect(
      daily(sent({ reminders: { firstAfterDays: 1, everyDays: 1, max: 0 } }).envelope, 30)
        .reminderDays,
    ).toEqual([]);
  });

  it('stops after a single reminder when everyDays is 0', () => {
    expect(
      daily(sent({ reminders: { firstAfterDays: 2, everyDays: 0, max: 1 } }).envelope, 30)
        .reminderDays,
    ).toEqual([2]);
  });

  it('only reminds recipients whose turn it is, counting from their own invitation', () => {
    const {
      envelope,
      ids: [a, b],
    } = sent({ reminders: { firstAfterDays: 2, everyDays: 2, max: 1 } });
    const day1 = submit(
      envelope,
      { recipientId: a!, values: valuesFor(envelope, a!) },
      d(at(1)),
    ).envelope;
    expect(reminded(tick(day1, new Date(at(2))))).toEqual([]);
    expect(reminded(tick(day1, new Date(at(3))))).toEqual([b]);
  });

  it('reminds every waiting recipient in parallel and skips those who signed', () => {
    const {
      envelope,
      ids: [a, b, c],
    } = sent({
      routing: 'parallel',
      reminders: { firstAfterDays: 1, everyDays: 1, max: 1 },
      recipients: [
        { name: 'A', email: 'a@example.com' },
        { name: 'B', email: 'b@example.com' },
        { name: 'C', email: 'c@example.com' },
      ],
    });
    const afterB = submit(
      envelope,
      { recipientId: b!, values: valuesFor(envelope, b!) },
      d(),
    ).envelope;
    expect(reminded(tick(afterB, new Date(at(1))))).toEqual([a, c]);
  });

  it('keeps reminding a recipient who viewed but has not signed', () => {
    const { envelope } = sent({ reminders: { firstAfterDays: 1, everyDays: 1, max: 1 } });
    const viewed = {
      ...envelope,
      recipients: envelope.recipients.map((r, i) =>
        i === 0 ? { ...r, status: 'viewed' as const } : r,
      ),
    };
    expect(reminded(tick(viewed, new Date(at(1))))).toHaveLength(1);
  });
});

describe('tick expiry', () => {
  it('expires the envelope once the expiry passes and tells invited recipients', () => {
    const {
      envelope,
      ids: [a],
    } = sent({ expiresAt: at(5) });
    expect(tick(envelope, new Date(at(4.99))).envelope.status).toBe('sent');
    const result = tick(envelope, new Date(at(5)));
    expect(result.envelope.status).toBe('expired');
    expect(isFinal(result.envelope)).toBe(true);
    expect(result.events).toEqual([
      {
        envelopeId: envelope.id,
        action: 'envelope.expired',
        at: at(5),
        data: { expiresAt: at(5) },
      },
    ]);
    expect(result.effects).toEqual([
      { kind: 'notify', recipientId: a, reason: 'cancelled' },
      { kind: 'webhook', event: 'envelope.expired', envelopeId: envelope.id },
    ]);
  });

  it('expires instead of reminding when both are due', () => {
    const { envelope } = sent({
      expiresAt: at(3),
      reminders: { firstAfterDays: 1, everyDays: 1, max: 5 },
    });
    const result = tick(envelope, new Date(at(10)));
    expect(result.envelope.status).toBe('expired');
    expect(reminded(result)).toEqual([]);
  });

  it('expires an envelope that is part signed', () => {
    const {
      envelope,
      ids: [a, b],
    } = sent({ expiresAt: at(5) });
    const partly = submit(
      envelope,
      { recipientId: a!, values: valuesFor(envelope, a!) },
      d(at(1)),
    ).envelope;
    const expired = tick(partly, new Date(at(6))).envelope;
    expect(expired.status).toBe('expired');
    expect(
      errorCode(() =>
        submit(expired, { recipientId: b!, values: valuesFor(expired, b!) }, d(at(6))),
      ),
    ).toBe('INVALID_STATE');
  });

  it('is idempotent once expired', () => {
    const { envelope } = sent({ expiresAt: at(5) });
    const expired = tick(envelope, new Date(at(5))).envelope;
    const again = tick(expired, new Date(at(6)));
    expect(again.envelope).toBe(expired);
    expect(again.events).toEqual([]);
  });
});

describe('tick on inactive envelopes', () => {
  it('does nothing to drafts or final envelopes', () => {
    const {
      envelope,
      ids: [a],
    } = ready({ expiresAt: at(1) });
    expect(tick(envelope, new Date(at(5))).events).toEqual([]);
    const s = send(envelope, d()).envelope;
    const declined = decline(s, { recipientId: a!, reason: 'no' }, d()).envelope;
    const voided = voidEnvelope(s, { reason: 'no' }, d()).envelope;
    for (const e of [declined, voided]) {
      const result = tick(e, new Date(at(5)));
      expect(result.envelope).toBe(e);
      expect(result.events).toEqual([]);
    }
  });
});

describe('routing helpers', () => {
  it('has no current recipients outside sent and in progress', () => {
    const { envelope } = ready();
    expect(currentRecipients(envelope)).toEqual([]);
    expect(isActive(envelope)).toBe(false);
  });

  it('reports final statuses', () => {
    expect(
      ['completed', 'declined', 'expired', 'voided'].every((s) => isFinal(s as Envelope['status'])),
    ).toBe(true);
    expect(['draft', 'sent', 'in_progress'].some((s) => isFinal(s as Envelope['status']))).toBe(
      false,
    );
  });

  it('gives the next time tick has work to do', () => {
    const { envelope } = sent({
      expiresAt: at(10),
      reminders: { firstAfterDays: 2, everyDays: 3, max: 2 },
    });
    expect(nextTickAt(envelope)?.toISOString()).toBe(at(2));
    const first = tick(envelope, new Date(at(2))).envelope;
    expect(nextTickAt(first)?.toISOString()).toBe(at(5));
    const second = tick(first, new Date(at(5))).envelope;
    expect(nextTickAt(second)?.toISOString()).toBe(at(10));
    expect(nextTickAt(tick(second, new Date(at(10))).envelope)).toBeUndefined();
  });

  it('has nothing scheduled without reminders or expiry', () => {
    const { envelope } = sent({ reminders: { firstAfterDays: 0, everyDays: 0, max: 0 } });
    expect(nextTickAt(envelope)).toBeUndefined();
    expect(nextReminderAt(envelope, envelope.recipients[0]!)).toBeUndefined();
  });

  it('does not schedule reminders for recipients not yet invited', () => {
    const { envelope } = sent({ reminders: { firstAfterDays: 1, everyDays: 1, max: 1 } });
    expect(nextReminderAt(envelope, envelope.recipients[1]!)).toBeUndefined();
  });
});
