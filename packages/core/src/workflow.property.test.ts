import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commitTransition, verifyChain } from './audit';
import { isActor } from './builder';
import { webCryptoHasher as hasher } from './defaults';
import { currentRecipients, hasActed, isActive, isExpiredAt, isFinal } from './routing';
import { at, clockAt, ready, T0, valuesFor } from './test/fixtures';
import type { AuditEvent, Envelope, RecipientRole, RoutingMode, TransitionResult } from './types';
import { SignError } from './types';
import {
  decline,
  markAuthenticated,
  markViewed,
  recordSeal,
  send,
  submit,
  tick,
  voidEnvelope,
} from './workflow';

interface Setup {
  routing: RoutingMode;
  recipients: { role: RecipientRole; order: number }[];
  expiresInDays: number | null;
}

const setup: fc.Arbitrary<Setup> = fc
  .record({
    routing: fc.constantFrom<RoutingMode>('sequential', 'parallel'),
    recipients: fc.array(
      fc.record({
        role: fc.constantFrom<RecipientRole>('signer', 'approver', 'viewer'),
        order: fc.integer({ min: 1, max: 3 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    expiresInDays: fc.option(fc.integer({ min: 1, max: 10 })),
  })
  .filter((s) => s.recipients.some((r) => r.role !== 'viewer'));

type Op =
  | { kind: 'submit' | 'decline' | 'view' | 'authenticate'; who: number }
  | { kind: 'submit-foreign'; who: number; owner: number }
  | { kind: 'void' | 'tick' | 'seal' };

const who = fc.nat({ max: 4 });
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('submit' as const), who }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('decline' as const), who }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('view' as const), who }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('authenticate' as const), who }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('submit-foreign' as const), who, owner: who }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom('void' as const, 'tick' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('seal' as const) }) },
);

const step = fc.record({ op, hours: fc.integer({ min: 0, max: 48 }) });

function build(s: Setup): { envelope: Envelope; ids: string[]; documentId: string } {
  const r = ready({
    routing: s.routing,
    ...(s.expiresInDays !== null && { expiresAt: at(s.expiresInDays) }),
    recipients: s.recipients.map((x, i) => ({
      name: `R${i}`,
      email: `r${i}@example.com`,
      role: x.role,
      order: x.order,
    })),
  });
  return { envelope: r.envelope, ids: r.ids, documentId: r.documentId };
}

function apply(
  envelope: Envelope,
  o: Op,
  ids: string[],
  documentId: string,
  now: string,
): TransitionResult {
  const deps = { clock: clockAt(now) };
  const id = (n: number) => ids[n % ids.length]!;
  switch (o.kind) {
    case 'submit':
      return submit(
        envelope,
        { recipientId: id(o.who), values: valuesFor(envelope, id(o.who)) },
        deps,
      );
    case 'submit-foreign':
      return submit(
        envelope,
        { recipientId: id(o.who), values: valuesFor(envelope, id(o.owner)) },
        deps,
      );
    case 'decline':
      return decline(envelope, { recipientId: id(o.who), reason: 'Not agreed' }, deps);
    case 'view':
      return markViewed(envelope, { recipientId: id(o.who) }, deps);
    case 'authenticate':
      return markAuthenticated(envelope, { recipientId: id(o.who) }, deps);
    case 'void':
      return voidEnvelope(envelope, { reason: 'Withdrawn' }, deps);
    case 'tick':
      return tick(envelope, new Date(now));
    case 'seal':
      return recordSeal(envelope, { documentId, sha256: 'b'.repeat(64) }, deps);
  }
}

const actorsOf = (e: Envelope) => e.recipients.filter(isActor);
const allAgreed = (e: Envelope) =>
  actorsOf(e).every((r) => r.status === 'signed' || r.status === 'approved');

/** Whose turn it is, computed from the rules rather than from `currentRecipients`. */
function mayAct(e: Envelope, recipientId: string): boolean {
  const r = e.recipients.find((x) => x.id === recipientId);
  if (!r || !isActor(r) || hasActed(r) || !isActive(e)) return false;
  if (e.routing === 'parallel') return true;
  return actorsOf(e).every((other) => other.order >= r.order || hasActed(other));
}

function invariants(e: Envelope): void {
  expect(e.status === 'completed').toBe(allAgreed(e));
  if (e.status === 'completed') expect(e.completedAt).toBeDefined();
  if (e.status === 'declined') {
    expect(actorsOf(e).filter((r) => r.status === 'declined')).toHaveLength(1);
  } else {
    expect(e.recipients.some((r) => r.status === 'declined')).toBe(false);
  }
  if (isActive(e)) {
    const current = new Set(currentRecipients(e).map((r) => r.id));
    for (const r of actorsOf(e)) {
      if (r.status === 'notified' || r.status === 'viewed') expect(current.has(r.id)).toBe(true);
      if (current.has(r.id)) expect(r.status === 'notified' || r.status === 'viewed').toBe(true);
    }
  }
  const owners = new Map(e.fields.map((f) => [f.id, f.recipientId]));
  for (const value of e.values) {
    const owner = e.recipients.find((r) => r.id === owners.get(value.fieldId));
    expect(owner?.status).toBe('signed');
  }
}

describe('workflow properties', () => {
  it('nobody acts out of turn, completion means everyone agreed, final states never change', async () => {
    await fc.assert(
      fc.asyncProperty(setup, fc.array(step, { maxLength: 25 }), async (s, steps) => {
        const { envelope: draft, ids, documentId } = build(s);
        const sent = send(draft, { clock: clockAt(T0) });
        let committed = await commitTransition(sent, 1, hasher);
        let envelope = committed.envelope;
        const log: AuditEvent[] = [...committed.events];
        let now = Date.parse(T0);
        invariants(envelope);

        for (const { op: o, hours } of steps) {
          now += hours * 3_600_000;
          const iso = new Date(now).toISOString();
          const before = envelope;
          const actor = 'who' in o ? ids[o.who % ids.length]! : undefined;
          let result: TransitionResult | undefined;
          try {
            result = apply(before, o, ids, documentId, iso);
          } catch (error) {
            expect(error).toBeInstanceOf(SignError);
          }

          if (isFinal(before)) {
            if (result) {
              expect(result.envelope).toEqual(before);
              expect(result.events.every((e) => e.action === 'document.sealed')).toBe(true);
            }
          }

          const open = isActive(before) && !isExpiredAt(before, new Date(now));
          if (o.kind === 'submit' || o.kind === 'decline') {
            expect(result !== undefined).toBe(open && mayAct(before, actor!));
          }
          if (o.kind === 'submit-foreign' && o.who % ids.length !== o.owner % ids.length) {
            const ownerHasFields = before.fields.some(
              (f) => f.required && f.recipientId === ids[o.owner % ids.length],
            );
            if (ownerHasFields) expect(result).toBeUndefined();
          }
          if (o.kind === 'authenticate' && result) expect(mayAct(before, actor!)).toBe(true);

          if (!result) continue;
          for (const r of before.recipients) {
            if (!hasActed(r)) continue;
            const after = result.envelope.recipients.find((x) => x.id === r.id)!;
            expect(after.status).toBe(r.status);
            expect(after.actedAt).toBe(r.actedAt);
          }

          committed = await commitTransition(result, log.length + 1, hasher);
          envelope = committed.envelope;
          log.push(...committed.events);
          invariants(envelope);
        }

        const chain = await verifyChain(log, hasher, { expectedHead: envelope.auditHead });
        expect(chain.valid).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('a recipient who has acted can never act again', () => {
    fc.assert(
      fc.property(setup, fc.nat(), (s, pick) => {
        const { envelope: draft, ids } = build(s);
        const envelope = send(draft, { clock: clockAt(T0) }).envelope;
        const current = currentRecipients(envelope);
        const first = current[pick % current.length]!;
        const done = submit(
          envelope,
          { recipientId: first.id, values: valuesFor(envelope, first.id) },
          { clock: clockAt(T0) },
        ).envelope;
        for (const again of [
          () =>
            submit(
              done,
              { recipientId: first.id, values: valuesFor(done, first.id) },
              { clock: clockAt(T0) },
            ),
          () =>
            decline(
              done,
              { recipientId: first.id, reason: 'Changed my mind' },
              { clock: clockAt(T0) },
            ),
        ]) {
          expect(again).toThrow(SignError);
        }
        expect(ids).toContain(first.id);
      }),
    );
  });

  it('two submits computed from the same snapshot each lose the other, so stores must check versions', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), (count) => {
        const { envelope: draft, ids } = build({
          routing: 'parallel',
          recipients: Array.from({ length: count }, () => ({ role: 'signer', order: 1 })),
          expiresInDays: null,
        });
        const snapshot = send(draft, { clock: clockAt(T0) }).envelope;
        const [a, b] = ids as [string, string];
        const deps = { clock: clockAt(T0) };
        const fromA = submit(snapshot, { recipientId: a, values: valuesFor(snapshot, a) }, deps);
        const fromB = submit(snapshot, { recipientId: b, values: valuesFor(snapshot, b) }, deps);
        const statusIn = (e: Envelope, id: string) => e.recipients.find((r) => r.id === id)!.status;
        expect(statusIn(fromA.envelope, b)).not.toBe('signed');
        expect(statusIn(fromB.envelope, a)).not.toBe('signed');
        const merged = submit(
          fromA.envelope,
          { recipientId: b, values: valuesFor(snapshot, b) },
          deps,
        );
        expect(statusIn(merged.envelope, a)).toBe('signed');
        expect(statusIn(merged.envelope, b)).toBe('signed');
      }),
      { numRuns: 10 },
    );
  });
});
