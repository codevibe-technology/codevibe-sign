import {
  nextTickAt,
  type AuditEvent,
  type Envelope,
  type Id,
  type OtpState,
} from '@codevibe_technology/sign-core';
import postgres from 'postgres';
import { VersionConflictError } from '../errors';
import { DEFAULT_WORKSPACE } from '../tenancy';
import { decodeCursor, encodeCursor } from './cursor';
import { migrations } from './migrations';
import type { Template } from '../template';
import type {
  EnvelopePage,
  IdempotencyClaim,
  Job,
  JobKind,
  ServerStore,
  TemplateStore,
} from './types';

type Sql = postgres.Sql;
type Json = postgres.JSONValue;

const MIGRATION_LOCK = 724_001_337;

const asJson = (value: unknown) => value as Json;

/**
 * Creates the tables `postgresStore` needs. Safe to call on every start: applied
 * migrations are recorded in `sign_migrations` and skipped, and a lock keeps two
 * processes from migrating at once.
 */
export async function migrate(sql: Sql): Promise<string[]> {
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    // Checked first so a server role without CREATE rights can start once migrations are in.
    const [registry] = await tx<{ table: string | null }[]>`
      select to_regclass('sign_migrations')::text as table`;
    if (!registry?.table) {
      await tx`create table sign_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`;
    }
    const rows = await tx<{ name: string }[]>`select name from sign_migrations`;
    const done = new Set(rows.map((row) => row.name));
    for (const migration of migrations) {
      if (done.has(migration.name)) continue;
      await tx.unsafe(migration.sql);
      await tx`insert into sign_migrations (name) values (${migration.name})`;
      applied.push(migration.name);
    }
  });
  return applied;
}

const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, '\\$&')}%`;

function postgresTemplates(sql: Sql): TemplateStore {
  return {
    async insert(workspaceId, template) {
      await sql`insert into sign_templates (id, workspace_id, name, data, created_at, updated_at)
        values (${template.id}, ${workspaceId}, ${template.name}, ${sql.json(asJson(template))},
          ${new Date(template.createdAt)}, ${new Date(template.updatedAt)})`;
    },
    async get(workspaceId, id) {
      const rows = await sql<{ data: Template }[]>`
        select data from sign_templates where id = ${id} and workspace_id = ${workspaceId}`;
      return rows[0]?.data ?? null;
    },
    async list(workspaceId, query) {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await sql<{ data: Template; created_at: Date; id: string }[]>`
        select data, created_at, id from sign_templates
        where workspace_id = ${workspaceId}
          ${query.search ? sql`and name ilike ${likePattern(query.search)}` : sql``}
          ${after ? sql`and (created_at, id) < (${new Date(after.createdAt)}, ${after.id})` : sql``}
        order by created_at desc, id desc
        limit ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        templates: page.map((row) => row.data),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
            : null,
      };
    },
    async replace(workspaceId, template, expectedUpdatedAt) {
      const rows = await sql`update sign_templates
        set name = ${template.name}, data = ${sql.json(asJson(template))},
          updated_at = ${new Date(template.updatedAt)}
        where id = ${template.id} and workspace_id = ${workspaceId}
          and data->>'updatedAt' = ${expectedUpdatedAt}
        returning id`;
      return rows.length > 0;
    },
    async remove(workspaceId, id) {
      const rows = await sql`delete from sign_templates
        where id = ${id} and workspace_id = ${workspaceId} returning id`;
      return rows.length > 0;
    },
  };
}

/**
 * Stores envelopes, audit events, tokens and jobs in PostgreSQL through the `postgres`
 * driver. Pass a connection string or your own `postgres()` instance; run `migrate()` first.
 */
export function postgresStore(connection: Sql | string): ServerStore & { sql: Sql } {
  const sql: Sql = typeof connection === 'string' ? postgres(connection) : connection;

  async function write(
    envelope: Envelope,
    events: AuditEvent[],
    expectedVersion: number | undefined,
    jobs: Job[],
    workspaceId: string = DEFAULT_WORKSPACE,
  ): Promise<{ version: number }> {
    const nextCheck = nextTickAt(envelope) ?? null;
    const createdAt = new Date(envelope.createdAt);
    return sql.begin(async (tx) => {
      let rows: { version: number }[];
      if (expectedVersion === 0) {
        rows = await tx<{ version: number }[]>`
          insert into sign_envelopes
            (id, status, data, version, next_check_at, workspace_id, created_at)
          values (${envelope.id}, ${envelope.status}, ${tx.json(asJson(envelope))}, 1, ${nextCheck},
            ${workspaceId}, ${createdAt})
          on conflict (id) do nothing
          returning version`;
      } else if (expectedVersion === undefined) {
        rows = await tx<{ version: number }[]>`
          insert into sign_envelopes
            (id, status, data, version, next_check_at, workspace_id, created_at)
          values (${envelope.id}, ${envelope.status}, ${tx.json(asJson(envelope))}, 1, ${nextCheck},
            ${workspaceId}, ${createdAt})
          on conflict (id) do update set
            status = excluded.status, data = excluded.data, next_check_at = excluded.next_check_at,
            version = sign_envelopes.version + 1, updated_at = now()
          returning version`;
      } else {
        rows = await tx<{ version: number }[]>`
          update sign_envelopes set
            status = ${envelope.status}, data = ${tx.json(asJson(envelope))},
            next_check_at = ${nextCheck}, version = version + 1, updated_at = now()
          where id = ${envelope.id} and version = ${expectedVersion}
          returning version`;
      }
      const row = rows[0];
      if (!row) throw new VersionConflictError(envelope.id);
      for (const event of events) {
        await tx`insert into sign_audit_events (envelope_id, seq, data)
          values (${event.envelopeId}, ${event.seq}, ${tx.json(asJson(event))})`;
      }
      for (const job of jobs) await insertJob(tx, job);
      return { version: row.version };
    });
  }

  async function insertJob(target: Sql | postgres.TransactionSql, job: Job) {
    await target`insert into sign_jobs (id, kind, payload, attempts, run_at)
      values (${job.id}, ${job.kind}, ${target.json(asJson(job.payload))}, ${job.attempts}, ${job.runAt})`;
  }

  return {
    sql,
    async get(id) {
      const rows = await sql<
        { data: Envelope }[]
      >`select data from sign_envelopes where id = ${id}`;
      return rows[0]?.data ?? null;
    },
    async load(id) {
      const rows = await sql<{ data: Envelope; version: number; workspace_id: string }[]>`
        select data, version, workspace_id from sign_envelopes where id = ${id}`;
      const row = rows[0];
      return row
        ? { envelope: row.data, version: row.version, workspaceId: row.workspace_id }
        : null;
    },
    save: (envelope, events, expectedVersion) => write(envelope, events, expectedVersion, []),
    commit: (envelope, events, expectedVersion, jobs, options) =>
      write(envelope, events, expectedVersion, jobs, options?.workspaceId),
    async list(workspaceId, query): Promise<EnvelopePage> {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const pattern = query.search ? likePattern(query.search) : null;
      const rows = await sql<{ data: Envelope; created_at: Date; id: string }[]>`
        select data, created_at, id from sign_envelopes
        where workspace_id = ${workspaceId}
          ${query.status?.length ? sql`and status in ${sql(query.status)}` : sql``}
          ${pattern ? sql`and data->>'title' ilike ${pattern}` : sql``}
          ${after ? sql`and (created_at, id) < (${new Date(after.createdAt)}, ${after.id})` : sql``}
        order by created_at desc, id desc
        limit ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        envelopes: page.map((row) => row.data),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
            : null,
      };
    },
    async listEvents(envelopeId) {
      const rows = await sql<{ data: AuditEvent }[]>`
        select data from sign_audit_events where envelope_id = ${envelopeId} order by seq`;
      return rows.map((row) => row.data);
    },
    async findSealed(sha256) {
      const rows = await sql<{ envelope_id: string; document_id: string | null }[]>`
        select envelope_id, data->'data'->>'documentId' as document_id
        from sign_audit_events
        where data->>'action' = 'document.sealed' and data->'data'->>'sha256' = ${sha256}
        limit 1`;
      const row = rows[0];
      return row?.document_id ? { envelopeId: row.envelope_id, documentId: row.document_id } : null;
    },
    templateStore: postgresTemplates(sql),
    async due(now, limit) {
      const rows = await sql<{ data: Envelope }[]>`
        select data from sign_envelopes
        where next_check_at is not null and next_check_at <= ${now}
        order by next_check_at limit ${limit}`;
      return rows.map((row) => row.data);
    },
    async deferCheck(id, until) {
      await sql`update sign_envelopes set next_check_at = ${until}
        where id = ${id} and next_check_at is not null`;
    },

    async putToken(token) {
      await sql`insert into sign_tokens (hash, envelope_id, recipient_id, expires_at, revoked_at)
        values (${token.hash}, ${token.envelopeId}, ${token.recipientId}, ${token.expiresAt},
          ${token.revokedAt ?? null})`;
    },
    async findToken(hash) {
      const rows = await sql<
        { envelope_id: Id; recipient_id: Id; expires_at: Date; revoked_at: Date | null }[]
      >`select envelope_id, recipient_id, expires_at, revoked_at from sign_tokens where hash = ${hash}`;
      const row = rows[0];
      if (!row) return null;
      return {
        hash,
        envelopeId: row.envelope_id,
        recipientId: row.recipient_id,
        expiresAt: row.expires_at,
        ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
      };
    },
    async revokeTokens(envelopeId, recipientId, at) {
      if (recipientId === undefined) {
        await sql`update sign_tokens set revoked_at = ${at}
          where envelope_id = ${envelopeId} and revoked_at is null`;
      } else {
        await sql`update sign_tokens set revoked_at = ${at}
          where envelope_id = ${envelopeId} and recipient_id = ${recipientId} and revoked_at is null`;
      }
    },

    async issueOtp({ envelopeId, recipientId, state }, maxIssued) {
      if (maxIssued < 1) return null;
      const rows = await sql<{ issued: number; version: number }[]>`
        insert into sign_otp_challenges
          (envelope_id, recipient_id, state, expires_at, issued, version)
        values (${envelopeId}, ${recipientId}, ${sql.json(asJson(state))},
          ${new Date(state.expiresAt)}, 1, 1)
        on conflict (envelope_id, recipient_id) do update set
          state = excluded.state, expires_at = excluded.expires_at,
          issued = sign_otp_challenges.issued + 1, version = sign_otp_challenges.version + 1
        where sign_otp_challenges.issued < ${maxIssued}
        returning issued, version`;
      const row = rows[0];
      return row
        ? { envelopeId, recipientId, state, issued: row.issued, version: row.version }
        : null;
    },
    async getOtp(envelopeId, recipientId) {
      const rows = await sql<{ state: OtpState; issued: number; version: number }[]>`
        select state, issued, version from sign_otp_challenges
        where envelope_id = ${envelopeId} and recipient_id = ${recipientId}`;
      const row = rows[0];
      return row
        ? { envelopeId, recipientId, state: row.state, issued: row.issued, version: row.version }
        : null;
    },
    async updateOtp(challenge, state) {
      const rows = await sql`
        update sign_otp_challenges set state = ${sql.json(asJson(state))}, version = version + 1
        where envelope_id = ${challenge.envelopeId} and recipient_id = ${challenge.recipientId}
          and version = ${challenge.version}
        returning version`;
      return rows.length > 0;
    },

    async claimIdempotency(scope, key, fingerprint, now): Promise<IdempotencyClaim> {
      const inserted = await sql`
        insert into sign_idempotency (scope, key, fingerprint, created_at)
        values (${scope}, ${key}, ${fingerprint}, ${now})
        on conflict (scope, key) do nothing
        returning key`;
      if (inserted.length > 0) return { state: 'new' };
      const rows = await sql<{ fingerprint: string; status: number | null; body: unknown }[]>`
        select fingerprint, status, body from sign_idempotency where scope = ${scope} and key = ${key}`;
      const row = rows[0];
      if (!row) return { state: 'in_progress' };
      if (row.fingerprint !== fingerprint) return { state: 'mismatch' };
      if (row.status === null) return { state: 'in_progress' };
      return { state: 'replay', status: row.status, body: row.body };
    },
    async completeIdempotency(scope, key, status, body) {
      await sql`update sign_idempotency set status = ${status}, body = ${sql.json(asJson(body))}
        where scope = ${scope} and key = ${key}`;
    },
    async releaseIdempotency(scope, key) {
      await sql`delete from sign_idempotency where scope = ${scope} and key = ${key}`;
    },

    async enqueue(jobs) {
      if (jobs.length === 0) return;
      await sql.begin(async (tx) => {
        for (const job of jobs) await insertJob(tx, job);
      });
    },
    async claimJobs(now, limit, leaseUntil) {
      const rows = await sql<
        {
          id: Id;
          kind: JobKind;
          payload: Record<string, unknown>;
          attempts: number;
          run_at: Date;
        }[]
      >`
        update sign_jobs set run_at = ${leaseUntil}, updated_at = now()
        where id in (
          select id from sign_jobs
          where state = 'pending' and run_at <= ${now}
          order by run_at
          limit ${limit}
          for update skip locked
        )
        returning id, kind, payload, attempts, run_at`;
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        attempts: row.attempts,
        runAt: row.run_at,
      }));
    },
    async completeJob(id) {
      await sql`update sign_jobs set state = 'done', updated_at = now() where id = ${id}`;
    },
    async failJob(id, error, retryAt) {
      if (retryAt) {
        await sql`update sign_jobs set attempts = attempts + 1, last_error = ${error},
          run_at = ${retryAt}, updated_at = now() where id = ${id}`;
      } else {
        await sql`update sign_jobs set attempts = attempts + 1, last_error = ${error},
          state = 'dead', updated_at = now() where id = ${id}`;
      }
    },

    async purge(now, idempotencyBefore) {
      await sql`delete from sign_tokens where expires_at <= ${now}`;
      await sql`delete from sign_otp_challenges c using sign_envelopes e
        where c.envelope_id = e.id
          and e.status in ('completed', 'declined', 'expired', 'voided')`;
      await sql`delete from sign_idempotency where created_at < ${idempotencyBefore}`;
      await sql`delete from sign_jobs where state = 'done'`;
    },
  };
}
