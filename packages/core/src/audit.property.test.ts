import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { appendEvents, canonicalize, verifyChain } from './audit';
import { webCryptoHasher as hasher } from './defaults';
import type { AuditAction, AuditEvent, PendingAuditEvent } from './types';

const ACTIONS: AuditAction[] = [
  'envelope.created',
  'envelope.sent',
  'envelope.completed',
  'envelope.declined',
  'envelope.expired',
  'envelope.voided',
  'recipient.notified',
  'recipient.reminded',
  'recipient.viewed',
  'recipient.authenticated',
  'recipient.signed',
  'recipient.approved',
  'recipient.declined',
  'document.sealed',
];

/** Keys that behave specially on plain objects are included on purpose. */
const key = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.constantFrom('__proto__', 'constructor', 'toString', 'hasOwnProperty', 'hash', 'prevHash'),
);

const dataValue = fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean());

const isoTime = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2040, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

const pendingEvent = (envelopeId: string): fc.Arbitrary<PendingAuditEvent> =>
  fc.record(
    {
      envelopeId: fc.constant(envelopeId),
      action: fc.constantFrom(...ACTIONS),
      at: isoTime,
      recipientId: fc.string({ minLength: 1, maxLength: 8 }),
      context: fc.record(
        { ip: fc.ipV4(), userAgent: fc.string({ maxLength: 30 }) },
        { requiredKeys: [] },
      ),
      data: fc.dictionary(key, dataValue, { maxKeys: 4 }),
    },
    { requiredKeys: ['envelopeId', 'action', 'at'] },
  );

const chainInput = fc.array(pendingEvent('env-1'), { minLength: 1, maxLength: 8 });

type Mutation =
  | { kind: 'action' | 'at' | 'recipient' | 'ip' | 'data-value' | 'data-key'; index: number }
  | { kind: 'remove'; index: number }
  | { kind: 'swap'; index: number; other: number }
  | { kind: 'duplicate'; index: number }
  | { kind: 'seq' | 'prev' | 'hash' | 'envelope'; index: number };

const mutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constantFrom(
      'action',
      'at',
      'recipient',
      'ip',
      'data-value',
      'data-key',
      'seq',
      'prev',
      'hash',
      'envelope',
    ),
    index: fc.nat(),
  }),
  fc.record({ kind: fc.constant('remove'), index: fc.nat() }),
  fc.record({ kind: fc.constant('duplicate'), index: fc.nat() }),
  fc.record({ kind: fc.constant('swap'), index: fc.nat(), other: fc.nat() }),
) as fc.Arbitrary<Mutation>;

function flip(hex: string): string {
  return (hex[0] === '0' ? '1' : '0') + hex.slice(1);
}

/** Applies one tampering to a stored log; returns null when the change would be a no-op. */
function tamper(log: AuditEvent[], m: Mutation): AuditEvent[] | null {
  const events = log.map((e) => structuredClone(e));
  const i = m.index % events.length;
  const e = events[i]!;
  switch (m.kind) {
    case 'action':
      e.action = e.action === 'recipient.signed' ? 'recipient.declined' : 'recipient.signed';
      break;
    case 'at':
      e.at = new Date(Date.parse(e.at) - 60_000).toISOString();
      break;
    case 'recipient':
      e.recipientId = `${e.recipientId ?? ''}x`;
      break;
    case 'ip':
      e.context = { ...e.context, ip: '203.0.113.9' };
      if (log[i]!.context?.ip === '203.0.113.9') return null;
      break;
    case 'data-value': {
      const keys = Object.keys(e.data ?? {});
      if (keys.length === 0) return null;
      const k = keys[0]!;
      const value = e.data![k];
      e.data![k] =
        typeof value === 'string' ? `${value}!` : typeof value === 'number' ? value + 1 : !value;
      break;
    }
    case 'data-key': {
      const data = e.data ?? {};
      if (Object.prototype.hasOwnProperty.call(data, '__proto__')) {
        delete (data as Record<string, unknown>)['__proto__'];
      } else {
        Object.defineProperty(data, '__proto__', {
          value: 'injected',
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      e.data = data;
      break;
    }
    case 'seq':
      e.seq += 1;
      break;
    case 'prev':
      e.prevHash = flip(e.prevHash);
      break;
    case 'hash':
      e.hash = flip(e.hash);
      break;
    case 'envelope':
      e.envelopeId = 'env-2';
      break;
    case 'remove':
      events.splice(i, 1);
      break;
    case 'duplicate':
      events.splice(i, 0, structuredClone(e));
      break;
    case 'swap': {
      const j = m.other % events.length;
      if (i === j) return null;
      [events[i], events[j]] = [events[j]!, events[i]!];
      break;
    }
  }
  return events;
}

/** Rebuilds a pending event as an attacker would, re-hashing from scratch after a change. */
function strip(event: AuditEvent): PendingAuditEvent {
  const rest: Partial<AuditEvent> = { ...event };
  delete rest.seq;
  delete rest.prevHash;
  delete rest.hash;
  return rest as PendingAuditEvent;
}

describe('audit chain properties', () => {
  it('a freshly built chain verifies and its head is the last hash', async () => {
    await fc.assert(
      fc.asyncProperty(chainInput, async (input) => {
        const log = await appendEvents(undefined, 1, input, hasher);
        const result = await verifyChain(log, hasher, { expectedHead: log.at(-1)!.hash });
        expect(result).toEqual({ valid: true, head: log.at(-1)!.hash });
      }),
    );
  });

  it('detects any single change, removal, duplication or reordering', async () => {
    await fc.assert(
      fc.asyncProperty(chainInput, mutation, async (input, m) => {
        const log = await appendEvents(undefined, 1, input, hasher);
        const head = log.at(-1)!.hash;
        const changed = tamper(log, m);
        fc.pre(changed !== null);
        const result = await verifyChain(changed!, hasher, { expectedHead: head });
        expect(result.valid).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('a rewritten chain verifies on its own but never with the original head', async () => {
    await fc.assert(
      fc.asyncProperty(chainInput, mutation, async (input, m) => {
        const log = await appendEvents(undefined, 1, input, hasher);
        const changed = tamper(log, m);
        fc.pre(changed !== null && changed.length > 0 && m.kind !== 'envelope');
        const rebuilt = await appendEvents(undefined, 1, changed!.map(strip), hasher);
        const sameContent =
          rebuilt.length === log.length &&
          rebuilt.every((e, i) => canonicalize(e) === canonicalize(log[i]!));
        fc.pre(!sameContent);
        expect((await verifyChain(rebuilt, hasher)).valid).toBe(true);
        expect((await verifyChain(rebuilt, hasher, { expectedHead: log.at(-1)!.hash })).valid).toBe(
          false,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('detects events cut off the end only when the expected head is given', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(pendingEvent('env-1'), { minLength: 2, maxLength: 6 }),
        async (input) => {
          const log = await appendEvents(undefined, 1, input, hasher);
          const truncated = log.slice(0, -1);
          expect((await verifyChain(truncated, hasher)).valid).toBe(true);
          const checked = await verifyChain(truncated, hasher, { expectedHead: log.at(-1)!.hash });
          expect(checked).toMatchObject({ valid: false, reason: 'head' });
        },
      ),
    );
  });

  it('a complete log of another envelope verifies only without the envelope id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(pendingEvent('env-2'), { minLength: 1, maxLength: 6 }),
        async (input) => {
          const log = await appendEvents(undefined, 1, input, hasher);
          const head = log.at(-1)!.hash;
          expect((await verifyChain(log, hasher, { expectedHead: head })).valid).toBe(true);
          expect(
            await verifyChain(log, hasher, { expectedHead: head, envelopeId: 'env-1' }),
          ).toEqual({ valid: false, brokenAt: 0, reason: 'envelope' });
          expect(
            (await verifyChain(log, hasher, { expectedHead: head, envelopeId: 'env-2' })).valid,
          ).toBe(true);
        },
      ),
    );
  });

  it('appending in batches gives the same chain as appending at once', async () => {
    await fc.assert(
      fc.asyncProperty(chainInput, fc.nat(), async (input, cut) => {
        const split = cut % (input.length + 1);
        const whole = await appendEvents(undefined, 1, input, hasher);
        const first = await appendEvents(undefined, 1, input.slice(0, split), hasher);
        const second = await appendEvents(
          first.at(-1)?.hash,
          split + 1,
          input.slice(split),
          hasher,
        );
        expect([...first, ...second]).toEqual(whole);
      }),
    );
  });
});

/** Shuffles object keys at every level without changing any value. */
function permuteKeys(value: unknown, seed: number): unknown {
  if (Array.isArray(value)) return value.map((item) => permuteKeys(item, seed));
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  const rotated = entries.map((_, i) => entries[(i + seed) % entries.length]!).reverse();
  const out: Record<string, unknown> = {};
  for (const [k, v] of rotated) {
    Object.defineProperty(out, k, {
      value: permuteKeys(v, seed + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

describe('canonicalize properties', () => {
  const event = pendingEvent('env-1');

  it('does not depend on key order', () => {
    fc.assert(
      fc.property(event, fc.nat(), (e, seed) => {
        expect(canonicalize(permuteKeys(e, seed) as PendingAuditEvent)).toBe(canonicalize(e));
      }),
    );
  });

  it('is a fixed point: parsing and canonicalizing again changes nothing', () => {
    fc.assert(
      fc.property(event, (e) => {
        const text = canonicalize(e);
        expect(canonicalize(JSON.parse(text) as PendingAuditEvent)).toBe(text);
      }),
    );
  });

  it('keeps every key and value, so different events never share a canonical form', () => {
    fc.assert(
      fc.property(event, event, (a, b) => {
        const same = canonicalize(a) === canonicalize(b);
        expect(same).toBe(JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b)));
      }),
    );
  });

  it('round-trips the data of an event, including awkward keys', () => {
    fc.assert(
      fc.property(event, (e) => {
        const parsed = JSON.parse(canonicalize(e)) as Record<string, unknown>;
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        expect(Object.keys(data).sort()).toEqual(Object.keys(e.data ?? {}).sort());
        for (const k of Object.keys(e.data ?? {})) expect(data[k]).toBe(e.data![k]);
      }),
    );
  });

  it('ignores the chain fields and nothing else', () => {
    fc.assert(
      fc.property(event, fc.string(), fc.string(), (e, prevHash, hash) => {
        expect(canonicalize({ ...e, prevHash, hash } as PendingAuditEvent)).toBe(canonicalize(e));
      }),
    );
  });
});

/** Reference canonical form built from own entries only, independent of the code under test. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;
  return Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, sortDeep(v)]);
}
