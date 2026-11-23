import {
  isFinal,
  nextTickAt,
  type AuditEvent,
  type Envelope,
  type Id,
} from '@codevibe_technology/sign-core';
import { VersionConflictError } from '../errors';
import { DEFAULT_WORKSPACE } from '../tenancy';
import { decodeCursor, encodeCursor } from './cursor';
import type {
  EnvelopePage,
  IdempotencyClaim,
  Job,
  OtpChallenge,
  ServerStore,
  SigningToken,
  StoredEnvelope,
  TemplateStore,
} from './types';
import type { Template } from '../template';

interface EnvelopeRow extends StoredEnvelope {
  workspaceId: string;
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

/** Newest first, then by id, the same order as the PostgreSQL store. */
function compareNewest(
  a: Pick<Envelope, 'createdAt' | 'id'>,
  b: Pick<Envelope, 'createdAt' | 'id'>,
): number {
  const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function memoryTemplates(): TemplateStore {
  const rows = new Map<Id, { workspaceId: string; template: Template }>();
  const owned = (workspaceId: string, id: Id) => {
    const row = rows.get(id);
    return row?.workspaceId === workspaceId ? row : undefined;
  };
  return {
    async insert(workspaceId, template) {
      if (rows.has(template.id)) throw new Error(`Template ${template.id} already exists`);
      rows.set(template.id, { workspaceId, template: clone(template) });
    },
    async get(workspaceId, id) {
      const row = owned(workspaceId, id);
      return row ? clone(row.template) : null;
    },
    async list(workspaceId, query) {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const search = query.search?.toLowerCase();
      const found = [...rows.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .map((row) => row.template)
        .filter((template) => !search || template.name.toLowerCase().includes(search))
        .sort(compareNewest)
        .filter((template) => !after || compareNewest(after, template) < 0);
      const page = found.slice(0, query.limit).map(clone);
      const last = page[page.length - 1];
      return {
        templates: page,
        nextCursor:
          found.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },
    async replace(workspaceId, template, expectedUpdatedAt) {
      const row = owned(workspaceId, template.id);
      if (!row || row.template.updatedAt !== expectedUpdatedAt) return false;
      row.template = clone(template);
      return true;
    },
    async remove(workspaceId, id) {
      return owned(workspaceId, id) ? rows.delete(id) : false;
    },
  };
}

/** Keeps everything in process memory. For tests, demos and single-process prototypes. */
export function memoryStore(): ServerStore {
  const envelopes = new Map<Id, EnvelopeRow>();
  const tokens = new Map<string, SigningToken>();
  const otps = new Map<string, OtpChallenge>();
  const idempotency = new Map<string, IdempotencyRow>();
  const jobs = new Map<Id, JobRow>();

  function write(
    envelope: Envelope,
    events: AuditEvent[],
    expectedVersion?: number,
    workspaceId?: string,
  ) {
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
      workspaceId: row?.workspaceId ?? workspaceId ?? DEFAULT_WORKSPACE,
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
      return row
        ? { envelope: clone(row.envelope), version: row.version, workspaceId: row.workspaceId }
        : null;
    },
    async save(envelope, events, expectedVersion) {
      return write(envelope, events, expectedVersion);
    },
    async commit(envelope, events, expectedVersion, newJobs, options) {
      const result = write(envelope, events, expectedVersion, options?.workspaceId);
      for (const job of newJobs) jobs.set(job.id, { ...clone(job), done: false });
      return result;
    },
    async list(workspaceId, query): Promise<EnvelopePage> {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const search = query.search?.toLowerCase();
      const rows = [...envelopes.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .filter((row) => !query.status?.length || query.status.includes(row.envelope.status))
        .filter((row) => !search || row.envelope.title.toLowerCase().includes(search))
        .sort((a, b) => compareNewest(a.envelope, b.envelope))
        .filter((row) => !after || compareNewest(after, row.envelope) < 0);
      const page = rows.slice(0, query.limit).map((row) => clone(row.envelope));
      const last = page[page.length - 1];
      return {
        envelopes: page,
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },
    async listEvents(envelopeId) {
      return clone(envelopes.get(envelopeId)?.events ?? []);
    },
    async findSealed(sha256) {
      for (const row of envelopes.values()) {
        const event = row.events.find(
          (e) => e.action === 'document.sealed' && e.data?.sha256 === sha256,
        );
        const documentId = event?.data?.documentId;
        if (typeof documentId === 'string') return { envelopeId: row.envelope.id, documentId };
      }
      return null;
    },
    templateStore: memoryTemplates(),
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
