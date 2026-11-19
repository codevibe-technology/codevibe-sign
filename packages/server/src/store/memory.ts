import {
  isFinal,
  nextTickAt,
  type AuditEvent,
  type Envelope,
  type Id,
} from '@codevibe_technology/sign-core';
import { VersionConflictError } from '../errors';
import type {
  IdempotencyClaim,
  Job,
  OtpChallenge,
  ServerStore,
  SigningToken,
  StoredEnvelope,
} from './types';

interface EnvelopeRow extends StoredEnvelope {
  events: AuditEvent[];
  nextCheckAt: number | null;
}

interface IdempotencyRow {
  fingerprint: string;
  createdAt: Date;
  response?: { status: number; body: unknown };
}

interface JobRow extends Job {
  done: boolean;
  lastError?: string;
}

const clone = <T>(value: T): T => structuredClone(value);
const otpKey = (envelopeId: Id, recipientId: Id) => `${envelopeId}\u0000${recipientId}`;
const idemKey = (scope: string, key: string) => `${scope}\u0000${key}`;

/** Keeps everything in process memory. For tests, demos and single-process prototypes. */
export function memoryStore(): ServerStore {
  const envelopes = new Map<Id, EnvelopeRow>();
  const tokens = new Map<string, SigningToken>();
  const otps = new Map<string, OtpChallenge>();
  const idempotency = new Map<string, IdempotencyRow>();
  const jobs = new Map<Id, JobRow>();

  function write(envelope: Envelope, events: AuditEvent[], expectedVersion?: number) {
    const row = envelopes.get(envelope.id);
    const current = row?.version ?? 0;
    if (expectedVersion !== undefined && expectedVersion !== current) {
      throw new VersionConflictError(envelope.id);
    }
    const seqs = new Set((row?.events ?? []).map((e) => `${e.envelopeId}:${e.seq}`));
    for (const event of events) {
      const key = `${event.envelopeId}:${event.seq}`;
      if (seqs.has(key)) throw new Error(`Audit event ${event.seq} already exists`);
      seqs.add(key);
    }
    const version = current + 1;
    envelopes.set(envelope.id, {
      envelope: clone(envelope),
      version,
      events: [...(row?.events ?? []), ...clone(events)],
      nextCheckAt: nextTickAt(envelope)?.getTime() ?? null,
    });
    return { version };
  }

  return {
    async get(id) {
      const row = envelopes.get(id);
      return row ? clone(row.envelope) : null;
    },
    async load(id) {
      const row = envelopes.get(id);
      return row ? { envelope: clone(row.envelope), version: row.version } : null;
    },
    async save(envelope, events, expectedVersion) {
      return write(envelope, events, expectedVersion);
    },
    async commit(envelope, events, expectedVersion, newJobs) {
      const result = write(envelope, events, expectedVersion);
      for (const job of newJobs) jobs.set(job.id, { ...clone(job), done: false });
      return result;
    },
    async listEvents(envelopeId) {
      return clone(envelopes.get(envelopeId)?.events ?? []);
    },
    async due(now, limit) {
      const out: Envelope[] = [];
      for (const row of envelopes.values()) {
        if (out.length >= limit) break;
        if (row.nextCheckAt !== null && row.nextCheckAt <= now.getTime()) {
          out.push(clone(row.envelope));
        }
      }
      return out;
    },
    async deferCheck(id, until) {
      const row = envelopes.get(id);
      if (row && row.nextCheckAt !== null) row.nextCheckAt = until.getTime();
    },

    async putToken(token) {
      tokens.set(token.hash, clone(token));
    },
    async findToken(hash) {
      const token = tokens.get(hash);
      return token ? clone(token) : null;
    },
    async revokeTokens(envelopeId, recipientId, at) {
      for (const token of tokens.values()) {
        if (token.envelopeId !== envelopeId) continue;
        if (recipientId !== undefined && token.recipientId !== recipientId) continue;
        token.revokedAt ??= new Date(at);
      }
    },

    async issueOtp({ envelopeId, recipientId, state }, maxIssued) {
      const key = otpKey(envelopeId, recipientId);
      const current = otps.get(key);
      if ((current?.issued ?? 0) >= maxIssued) return null;
      const next: OtpChallenge = {
        envelopeId,
        recipientId,
        state: clone(state),
        issued: (current?.issued ?? 0) + 1,
        version: (current?.version ?? 0) + 1,
      };
      otps.set(key, next);
      return clone(next);
    },
    async getOtp(envelopeId, recipientId) {
      const challenge = otps.get(otpKey(envelopeId, recipientId));
      return challenge ? clone(challenge) : null;
    },
    async updateOtp(challenge, state) {
      const key = otpKey(challenge.envelopeId, challenge.recipientId);
      const current = otps.get(key);
      if (!current || current.version !== challenge.version) return false;
      otps.set(key, { ...current, state: clone(state), version: current.version + 1 });
      return true;
    },

    async claimIdempotency(scope, key, fingerprint, now): Promise<IdempotencyClaim> {
      const k = idemKey(scope, key);
      const row = idempotency.get(k);
      if (!row) {
        idempotency.set(k, { fingerprint, createdAt: now });
        return { state: 'new' };
      }
      if (row.fingerprint !== fingerprint) return { state: 'mismatch' };
      if (!row.response) return { state: 'in_progress' };
      return { state: 'replay', status: row.response.status, body: clone(row.response.body) };
    },
    async completeIdempotency(scope, key, status, body) {
      const row = idempotency.get(idemKey(scope, key));
      if (row) row.response = { status, body: clone(body) };
    },
    async releaseIdempotency(scope, key) {
      idempotency.delete(idemKey(scope, key));
    },

    async enqueue(newJobs) {
      for (const job of newJobs) jobs.set(job.id, { ...clone(job), done: false });
    },
    async claimJobs(now, limit, leaseUntil) {
      const due = [...jobs.values()]
        .filter((job) => !job.done && job.runAt.getTime() <= now.getTime())
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
        .slice(0, limit);
      for (const job of due) job.runAt = new Date(leaseUntil);
      return due.map(({ id, kind, payload, attempts, runAt }) =>
        clone({ id, kind, payload, attempts, runAt }),
      );
    },
    async completeJob(id) {
      const job = jobs.get(id);
      if (job) job.done = true;
    },
    async failJob(id, error, retryAt) {
      const job = jobs.get(id);
      if (!job) return;
      job.attempts += 1;
      job.lastError = error;
      if (retryAt) job.runAt = new Date(retryAt);
      else job.done = true;
    },

    async purge(now, idempotencyBefore) {
      for (const [hash, token] of tokens) {
        if (token.expiresAt.getTime() <= now.getTime()) tokens.delete(hash);
      }
      for (const [k, challenge] of otps) {
        const envelope = envelopes.get(challenge.envelopeId)?.envelope;
        if (!envelope || isFinal(envelope)) otps.delete(k);
      }
      for (const [k, row] of idempotency) {
        if (row.createdAt.getTime() < idempotencyBefore.getTime()) idempotency.delete(k);
      }
      for (const [id, job] of jobs) if (job.done) jobs.delete(id);
    },
  };
}
