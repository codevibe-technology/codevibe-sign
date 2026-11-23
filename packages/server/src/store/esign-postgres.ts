import type { AuditContext, FieldValue } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import type {
  EsignOutcome,
  EsignSession,
  EsignSessionStatus,
  EsignSessionStore,
  EsignSignature,
} from '../esign/types';

type Sql = postgres.Sql;

/** What lives in the `data` column: everything that is never searched on. */
interface SessionData {
  values: FieldValue[];
  context?: AuditContext;
  signerName?: string;
  signature?: EsignSignature;
}

interface Row {
  id: string;
  workspace_id: string;
  envelope_id: string;
  recipient_id: string;
  document_id: string;
  provider: string;
  provider_ref: string | null;
  sign_url: string | null;
  status: EsignSessionStatus;
  data: SessionData;
  unsettled: EsignOutcome | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

const UNIQUE_VIOLATION = '23505';

function toSession(row: Row): EsignSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    envelopeId: row.envelope_id,
    recipientId: row.recipient_id,
    documentId: row.document_id,
    provider: row.provider,
    providerRef: row.provider_ref,
    signUrl: row.sign_url,
    status: row.status,
    values: row.data.values,
    ...(row.data.context ? { context: row.data.context } : {}),
    ...(row.data.signerName ? { signerName: row.data.signerName } : {}),
    ...(row.data.signature ? { signature: row.data.signature } : {}),
    ...(row.unsettled ? { unsettled: row.unsettled } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;

export function postgresEsignSessions(sql: Sql): EsignSessionStore {
  const json = (value: unknown) => sql.json(value as postgres.JSONValue);

  return {
    async insert(session) {
      const data: SessionData = {
        values: session.values,
        ...(session.context ? { context: session.context } : {}),
      };
      try {
        await sql`insert into sign_esign_sessions
          (id, workspace_id, envelope_id, recipient_id, document_id, provider, provider_ref,
            sign_url, status, data, created_at, updated_at, expires_at)
          values (${session.id}, ${session.workspaceId}, ${session.envelopeId},
            ${session.recipientId}, ${session.documentId}, ${session.provider},
            ${session.providerRef}, ${session.signUrl}, ${session.status}, ${json(data)},
            ${session.createdAt}, ${session.updatedAt}, ${session.expiresAt})`;
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },
    async activate(id, input) {
      try {
        const rows = await sql`update sign_esign_sessions
          set status = 'pending', provider_ref = ${input.providerRef}, sign_url = ${input.signUrl},
            expires_at = ${input.expiresAt}, updated_at = ${input.at}
          where id = ${id} and status = 'starting'
          returning id`;
        return rows.length > 0;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },
    async get(id) {
      const rows = await sql<Row[]>`select * from sign_esign_sessions where id = ${id}`;
      return rows[0] ? toSession(rows[0]) : null;
    },
    async findByRef(provider, providerRef) {
      const rows = await sql<Row[]>`select * from sign_esign_sessions
        where provider = ${provider} and provider_ref = ${providerRef}`;
      return rows[0] ? toSession(rows[0]) : null;
    },
    async latest(envelopeId, recipientId) {
      const rows = await sql<Row[]>`select * from sign_esign_sessions
        where envelope_id = ${envelopeId} and recipient_id = ${recipientId}
        order by created_at desc, id desc limit 1`;
      return rows[0] ? toSession(rows[0]) : null;
    },
    async open(envelopeId) {
      const rows = await sql<Row[]>`select * from sign_esign_sessions
        where envelope_id = ${envelopeId} and status in ('starting', 'pending')`;
      return rows.map(toSession);
    },
    async transition(id, from, to, at, patch = {}) {
      const merge: Partial<SessionData> = {
        ...(patch.signerName !== undefined ? { signerName: patch.signerName } : {}),
        ...(patch.signature !== undefined ? { signature: patch.signature } : {}),
      };
      const rows = await sql`update sign_esign_sessions
        set status = ${to}, updated_at = ${at}, data = data || ${json(merge)},
          unsettled = ${
            patch.unsettled === undefined ? sql`unsettled` : sql`${patch.unsettled}::text`
          }
        where id = ${id} and status in ${sql([...from])}
        returning id`;
      return rows.length > 0;
    },
    async settle(id) {
      await sql`update sign_esign_sessions set unsettled = null where id = ${id}`;
    },
    async due(now, limit) {
      const rows = await sql<Row[]>`select * from sign_esign_sessions
        where (status in ('starting', 'pending') and expires_at <= ${now})
          or unsettled is not null
        order by updated_at limit ${limit}`;
      return rows.map(toSession);
    },
  };
}
