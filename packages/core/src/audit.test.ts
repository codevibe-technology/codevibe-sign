import { describe, expect, it } from 'vitest';
import { appendEvents, canonicalize, commitTransition, GENESIS_HASH, verifyChain } from './audit';
import { webCryptoHasher as hasher } from './defaults';
import type { AuditEvent, Envelope, PendingAuditEvent } from './types';

const pending = (action: PendingAuditEvent['action'], extra: Partial<PendingAuditEvent> = {}) =>
  ({
    envelopeId: 'env-1',
    action,
    at: '2026-01-01T00:00:00.000Z',
    ...extra,
  }) satisfies PendingAuditEvent;

const sample = [
  pending('envelope.created'),
  pending('envelope.sent'),
  pending('recipient.signed', { recipientId: 'r1', context: { ip: '10.0.0.1' } }),
];

describe('canonicalize', () => {
  it('sorts keys at every level', () => {
    const a = canonicalize({ ...pending('envelope.sent'), data: { b: 1, a: 'x' } });
    const b = canonicalize({
      data: { a: 'x', b: 1 },
      at: sample[1]!.at,
      action: 'envelope.sent',
      envelopeId: 'env-1',
    });
    expect(a).toBe(b);
    expect(a).toBe(
      '{"action":"envelope.sent","at":"2026-01-01T00:00:00.000Z","data":{"a":"x","b":1},"envelopeId":"env-1"}',
    );
  });

  it('drops undefined members and the chain fields', () => {
    const text = canonicalize({
      ...pending('envelope.sent'),
      recipientId: undefined,
      seq: 3,
      prevHash: 'p',
      hash: 'h',
    } as never);
    expect(text).not.toContain('recipientId');
    expect(text).not.toContain('prevHash');
    expect(text).not.toContain('"hash"');
    expect(text).toContain('"seq":3');
  });

  it('keeps a __proto__ key in data, as JSON.parse returns it from storage', () => {
    const stored = JSON.parse(
      '{"envelopeId":"env-1","action":"envelope.sent","at":"2026-01-01T00:00:00.000Z","data":{"__proto__":"x"}}',
    ) as PendingAuditEvent;
    expect(canonicalize(stored)).toContain('"data":{"__proto__":"x"}');
    expect(canonicalize(stored)).not.toBe(canonicalize({ ...stored, data: {} }));
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ ...pending('envelope.sent'), data: { n: Number.NaN } })).toThrow(
      TypeError,
    );
  });
});

describe('appendEvents', () => {
  it('starts from the genesis hash and links each event to the previous one', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[0]!.prevHash).toBe(GENESIS_HASH);
    expect(events[1]!.prevHash).toBe(events[0]!.hash);
    expect(events[2]!.prevHash).toBe(events[1]!.hash);
    expect(events[0]!.hash).toBe(
      await hasher.sha256(GENESIS_HASH + canonicalize({ ...sample[0]!, seq: 1 })),
    );
  });

  it('continues an existing chain', async () => {
    const first = await appendEvents(undefined, 1, sample.slice(0, 2), hasher);
    const rest = await appendEvents(first[1]!.hash, 3, sample.slice(2), hasher);
    const whole = await appendEvents(undefined, 1, sample, hasher);
    expect([...first, ...rest]).toEqual(whole);
  });

  it('rejects a seq start below 1', async () => {
    await expect(appendEvents(undefined, 0, sample, hasher)).rejects.toThrow(RangeError);
  });
});

describe('verifyChain', () => {
  it('accepts an intact chain and an empty one', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    expect(await verifyChain(events, hasher)).toEqual({ valid: true, head: events[2]!.hash });
    expect(await verifyChain([], hasher)).toEqual({ valid: true, head: GENESIS_HASH });
  });

  it('detects an edited event', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    events[1] = { ...events[1]!, at: '2027-01-01T00:00:00.000Z' };
    expect(await verifyChain(events, hasher)).toEqual({
      valid: false,
      brokenAt: 1,
      reason: 'hash',
    });
  });

  it('detects a changed __proto__ value in stored data', async () => {
    const withKey = JSON.parse(
      '{"envelopeId":"env-1","action":"envelope.sent","at":"2026-01-01T00:00:00.000Z","data":{"routing":"parallel","__proto__":"a"}}',
    ) as PendingAuditEvent;
    const events = await appendEvents(undefined, 1, [sample[0]!, withKey], hasher);
    const tampered = JSON.parse(
      JSON.stringify(events).replace('"__proto__":"a"', '"__proto__":"b"'),
    ) as AuditEvent[];
    expect(await verifyChain(tampered, hasher)).toMatchObject({ valid: false, brokenAt: 1 });
  });

  it('detects an edited context', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    events[2] = { ...events[2]!, context: { ip: '1.2.3.4' } };
    expect(await verifyChain(events, hasher)).toMatchObject({ valid: false, brokenAt: 2 });
  });

  it('detects a rehashed event that no longer links', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    const [forged] = await appendEvents(
      undefined,
      2,
      [{ ...sample[1]!, action: 'envelope.voided' }],
      hasher,
    );
    events[1] = forged!;
    expect(await verifyChain(events, hasher)).toEqual({
      valid: false,
      brokenAt: 1,
      reason: 'prev_hash',
    });
  });

  it('detects a removed event', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    events.splice(1, 1);
    expect(await verifyChain(events, hasher)).toMatchObject({
      valid: false,
      brokenAt: 1,
      reason: 'seq',
    });
  });

  it('detects reordered events', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    const swapped = [events[0]!, events[2]!, events[1]!];
    expect(await verifyChain(swapped, hasher)).toMatchObject({ valid: false, brokenAt: 1 });
  });

  it('detects events from another envelope', async () => {
    const events = await appendEvents(
      undefined,
      1,
      [sample[0]!, { ...sample[1]!, envelopeId: 'env-2' }],
      hasher,
    );
    expect(await verifyChain(events, hasher)).toMatchObject({
      valid: false,
      brokenAt: 1,
      reason: 'envelope',
    });
  });

  it('detects a truncated tail when the expected head is given', async () => {
    const events = await appendEvents(undefined, 1, sample, hasher);
    const head = events[2]!.hash;
    expect(await verifyChain(events.slice(0, 2), hasher, { expectedHead: head })).toEqual({
      valid: false,
      brokenAt: 2,
      reason: 'head',
    });
    expect(await verifyChain(events, hasher, { expectedHead: head })).toMatchObject({
      valid: true,
    });
  });
});

describe('commitTransition', () => {
  const envelope = { id: 'env-1' } as Envelope;

  it('chains events after the current head and records the new head', async () => {
    const first = await commitTransition(
      { envelope, events: sample.slice(0, 1), effects: [] },
      1,
      hasher,
    );
    expect(first.envelope.auditHead).toBe(first.events[0]!.hash);
    const second = await commitTransition(
      {
        envelope: first.envelope,
        events: sample.slice(1),
        effects: [{ kind: 'seal', envelopeId: 'env-1' }],
      },
      2,
      hasher,
    );
    expect(second.effects).toEqual([{ kind: 'seal', envelopeId: 'env-1' }]);
    expect(await verifyChain([...first.events, ...second.events], hasher)).toEqual({
      valid: true,
      head: second.envelope.auditHead,
    });
  });

  it('leaves the envelope alone when there are no events', async () => {
    const result = await commitTransition({ envelope, events: [], effects: [] }, 1, hasher);
    expect(result.envelope).toBe(envelope);
    expect(result.events).toEqual([]);
  });
});
