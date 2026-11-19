import {
  createEnvelope,
  nextTickAt,
  send,
  addDocument,
  addRecipient,
  addField,
  type Envelope,
} from '@codevibe/sign-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VersionConflictError } from '../errors';
import { memoryStore } from './memory';
import { migrate, postgresStore } from './postgres';
import type { Job, ServerStore } from './types';

const T0 = new Date('2026-03-02T09:00:00.000Z');
let counter = 0;
const ids = { id: () => `id-${Date.now().toString(36)}-${++counter}` };
const clock = { now: () => T0 };

function draft(): Envelope {
  let { envelope } = createEnvelope({ title: 'Contract' }, { clock, ids });
  const doc = addDocument(
    envelope,
    { name: 'a.pdf', sha256: 'a'.repeat(64), pageCount: 1, fileKey: 'k' },
    { ids },
  );
  const r = addRecipient(doc.envelope, { name: 'A', email: 'a@example.com' }, { ids });
  envelope = addField(
    r.envelope,
    {
      documentId: doc.document.id,
      recipientId: r.recipient.id,
      type: 'signature',
      page: 0,
      rect: { x: 1, y: 1, width: 10, height: 10 },
    },
    { ids },
  ).envelope;
  return envelope;
}

const event = (envelope: Envelope, seq: number) => ({
  seq,
  envelopeId: envelope.id,
  action: 'envelope.created' as const,
  at: T0.toISOString(),
  prevHash: String(seq - 1),
  hash: String(seq),
});

const job = (id: string, runAt: Date): Job => ({
  id,
  kind: 'webhook',
  payload: { url: 'https://x', body: '{}' },
  attempts: 0,
  runAt,
});

function contract(name: string, make: () => Promise<ServerStore>) {
  describe(name, () => {
    let store: ServerStore;
    beforeAll(async () => {
      store = await make();
    });

    it('creates, versions and guards envelopes', async () => {
      const envelope = draft();
      expect(await store.commit(envelope, [event(envelope, 1)], 0, [])).toEqual({ version: 1 });
      await expect(store.commit(envelope, [], 0, [])).rejects.toBeInstanceOf(VersionConflictError);
      const changed = { ...envelope, title: 'Changed' };
      expect(await store.commit(changed, [event(envelope, 2)], 1, [])).toEqual({ version: 2 });
      await expect(store.commit(changed, [], 1, [])).rejects.toBeInstanceOf(VersionConflictError);
      expect(await store.load(envelope.id)).toEqual({ envelope: changed, version: 2 });
      expect((await store.listEvents(envelope.id)).map((e) => e.seq)).toEqual([1, 2]);
      expect(await store.get('missing')).toBeNull();
      expect(await store.save({ ...changed, title: 'Free' }, [])).toEqual({ version: 3 });
    });

    it('lists active envelopes once their next tick is due', async () => {
      const envelope = send(draft(), { clock }).envelope;
      await store.commit(envelope, [], 0, []);
      const at = nextTickAt(envelope)!;
      const ids = async (now: Date) => (await store.due(now, 1000)).map((e) => e.id);
      expect(await ids(new Date(at.getTime() - 1))).not.toContain(envelope.id);
      expect(await ids(at)).toContain(envelope.id);
      await store.deferCheck(envelope.id, new Date(at.getTime() + 60_000));
      expect(await ids(at)).not.toContain(envelope.id);
    });

    it('stores tokens by hash and revokes them', async () => {
      const envelope = draft();
      await store.commit(envelope, [], 0, []);
      const recipientId = envelope.recipients[0]!.id;
      const expiresAt = new Date(T0.getTime() + 60_000);
      await store.putToken({
        hash: `h-${envelope.id}`,
        envelopeId: envelope.id,
        recipientId,
        expiresAt,
      });
      expect(await store.findToken(`h-${envelope.id}`)).toEqual({
        hash: `h-${envelope.id}`,
        envelopeId: envelope.id,
        recipientId,
        expiresAt,
      });
      await store.revokeTokens(envelope.id, recipientId, T0);
      expect((await store.findToken(`h-${envelope.id}`))?.revokedAt).toEqual(T0);
      expect(await store.findToken('nope')).toBeNull();
    });

    const otpState = (attempts = 0) => ({
      codeHash: `x${attempts}`,
      salt: 'y',
      issuedAt: T0.toISOString(),
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
      attempts,
    });

    it('keeps one OTP challenge per recipient and counts every code issued', async () => {
      const envelope = draft();
      await store.commit(envelope, [], 0, []);
      const ids = { envelopeId: envelope.id, recipientId: envelope.recipients[0]!.id };
      const first = await store.issueOtp({ ...ids, state: otpState() }, 2);
      expect(first).toMatchObject({ issued: 1, state: { codeHash: 'x0' } });
      const second = await store.issueOtp({ ...ids, state: otpState(3) }, 2);
      expect(second).toMatchObject({ issued: 2 });
      expect(await store.getOtp(ids.envelopeId, ids.recipientId)).toMatchObject({
        issued: 2,
        state: { codeHash: 'x3' },
      });
      expect(await store.issueOtp({ ...ids, state: otpState(9) }, 2)).toBeNull();
      expect((await store.getOtp(ids.envelopeId, ids.recipientId))?.state.codeHash).toBe('x3');
    });

    it('saves an OTP check only against the version it read', async () => {
      const envelope = draft();
      await store.commit(envelope, [], 0, []);
      const ids = { envelopeId: envelope.id, recipientId: envelope.recipients[0]!.id };
      await store.issueOtp({ ...ids, state: otpState() }, 10);
      const read = (await store.getOtp(ids.envelopeId, ids.recipientId))!;
      const results = await Promise.all(
        Array.from({ length: 5 }, () => store.updateOtp(read, otpState(1))),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const after = (await store.getOtp(ids.envelopeId, ids.recipientId))!;
      expect(after.version).toBe(read.version + 1);
      expect(await store.updateOtp(after, otpState(2))).toBe(true);
    });

    it('caps OTP issuance under concurrency', async () => {
      const envelope = draft();
      await store.commit(envelope, [], 0, []);
      const ids = { envelopeId: envelope.id, recipientId: envelope.recipients[0]!.id };
      const issued = await Promise.all(
        Array.from({ length: 8 }, (_, i) => store.issueOtp({ ...ids, state: otpState(i) }, 3)),
      );
      expect(issued.filter((c) => c !== null)).toHaveLength(3);
    });

    it('keeps the OTP count until the envelope is final', async () => {
      const active = send(draft(), { clock }).envelope;
      await store.commit(active, [], 0, []);
      const ids = { envelopeId: active.id, recipientId: active.recipients[0]!.id };
      await store.issueOtp({ ...ids, state: otpState() }, 10);
      const later = new Date(T0.getTime() + 86_400_000);
      await store.purge(later, later);
      expect((await store.getOtp(ids.envelopeId, ids.recipientId))?.issued).toBe(1);
      await store.commit({ ...active, status: 'voided' }, [], 1, []);
      await store.purge(later, later);
      expect(await store.getOtp(ids.envelopeId, ids.recipientId)).toBeNull();
    });

    it('refuses a second audit event with the same seq', async () => {
      const envelope = draft();
      await store.commit(envelope, [event(envelope, 1)], 0, []);
      await expect(store.save(envelope, [event(envelope, 1)])).rejects.toThrow();
      expect((await store.listEvents(envelope.id)).map((e) => e.seq)).toEqual([1]);
    });

    it('claims, replays and rejects idempotency keys', async () => {
      const scope = `s-${++counter}`;
      expect(await store.claimIdempotency(scope, 'k', 'f1', T0)).toEqual({ state: 'new' });
      expect(await store.claimIdempotency(scope, 'k', 'f1', T0)).toEqual({ state: 'in_progress' });
      expect(await store.claimIdempotency(scope, 'k', 'f2', T0)).toEqual({ state: 'mismatch' });
      await store.completeIdempotency(scope, 'k', 201, { id: 'x' });
      expect(await store.claimIdempotency(scope, 'k', 'f1', T0)).toEqual({
        state: 'replay',
        status: 201,
        body: { id: 'x' },
      });
      await store.releaseIdempotency(scope, 'k');
      expect(await store.claimIdempotency(scope, 'k', 'f2', T0)).toEqual({ state: 'new' });
    });

    it('leases due jobs, retries and finishes them', async () => {
      const envelope = draft();
      const a = `job-a-${++counter}`;
      const b = `job-b-${counter}`;
      await store.commit(envelope, [], 0, [job(a, T0)]);
      await store.enqueue([job(b, new Date(T0.getTime() + 1000))]);
      const lease = new Date(T0.getTime() + 300_000);
      const claimed = await store.claimJobs(T0, 10, lease);
      expect(claimed.map((j) => j.id)).toContain(a);
      expect(claimed.map((j) => j.id)).not.toContain(b);
      expect((await store.claimJobs(T0, 10, lease)).map((j) => j.id)).not.toContain(a);

      await store.failJob(a, 'boom', new Date(T0.getTime() + 2000));
      const later = await store.claimJobs(new Date(T0.getTime() + 2000), 10, lease);
      expect(later.find((j) => j.id === a)?.attempts).toBe(1);
      await store.completeJob(a);
      await store.failJob(b, 'boom', null);
      const after = await store.claimJobs(new Date(T0.getTime() + 10_000_000), 10, lease);
      expect(after.map((j) => j.id)).not.toContain(a);
      expect(after.map((j) => j.id)).not.toContain(b);
    });

    it('lets exactly one of several racing writers win', async () => {
      const envelope = draft();
      const created = await Promise.allSettled(
        Array.from({ length: 5 }, () => store.commit(envelope, [event(envelope, 1)], 0, [])),
      );
      expect(created.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of created.filter((r) => r.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);
      }

      const updated = await Promise.allSettled(
        Array.from({ length: 5 }, () => store.commit(envelope, [event(envelope, 2)], 1, [])),
      );
      expect(updated.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await store.listEvents(envelope.id)).toHaveLength(2);
    });

    it('claims an idempotency key and leases a job only once under concurrency', async () => {
      const scope = `race-${++counter}`;
      const claims = await Promise.all(
        Array.from({ length: 5 }, () => store.claimIdempotency(scope, 'k', 'f', T0)),
      );
      expect(claims.filter((c) => c.state === 'new')).toHaveLength(1);

      const id = `job-race-${counter}`;
      const at = new Date(T0.getTime() - 60_000);
      await store.enqueue([job(id, at)]);
      const lease = new Date(T0.getTime() + 300_000);
      const leases = await Promise.all(
        Array.from({ length: 5 }, () => store.claimJobs(T0, 100, lease)),
      );
      expect(leases.flat().filter((j) => j.id === id)).toHaveLength(1);
    });
  });
}

contract('memoryStore', async () => memoryStore());

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('postgresStore', () => {
  const schema = `sign_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    const runs = await Promise.all([migrate(sql), migrate(sql), migrate(sql)]);
    expect(runs.flat()).toEqual(['0001_init', '0002_otp_issuance']);
    expect(await migrate(sql)).toEqual([]);
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  contract('contract', async () => postgresStore(sql));

  it('runs with a role that may only insert and read audit events', async () => {
    const role = `sign_app_${process.pid}_${Date.now()}`;
    const password = `pw-${Math.random().toString(36).slice(2)}`;
    const grants = [
      `create role ${role} login password '${password}'`,
      `grant usage on schema ${schema} to ${role}`,
      `grant select on ${schema}.sign_migrations to ${role}`,
      `grant select, insert, update on ${schema}.sign_envelopes to ${role}`,
      `grant select, insert on ${schema}.sign_audit_events to ${role}`,
      `grant select, insert, update, delete on ${schema}.sign_tokens, ${schema}.sign_otp_challenges,
        ${schema}.sign_idempotency, ${schema}.sign_jobs to ${role}`,
    ];
    for (const statement of grants) await admin.unsafe(statement);
    const target = new URL(url!);
    target.username = role;
    target.password = password;
    const app = postgres(target.toString(), {
      max: 1,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    try {
      expect(await migrate(app)).toEqual([]);
      const store = postgresStore(app);
      const envelope = draft();
      await store.commit(envelope, [event(envelope, 1)], 0, []);
      await store.purge(T0, T0);
      await expect(app`update sign_audit_events set data = '{}'`).rejects.toThrow(/permission/);
      await expect(app`delete from sign_audit_events`).rejects.toThrow(/permission/);
      await expect(app`delete from sign_envelopes`).rejects.toThrow(/permission/);
      await expect(app`truncate sign_audit_events`).rejects.toThrow(/permission/);
      expect(await store.listEvents(envelope.id)).toHaveLength(1);
    } finally {
      await app.end();
      await admin.unsafe(`drop owned by ${role}`);
      await admin.unsafe(`drop role ${role}`);
    }
  });
});
