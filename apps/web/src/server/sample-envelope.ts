import 'server-only';
import type { ApiEnvelope as Envelope } from '@codevibe_technology/sign-server';
import type { Principal } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import {
  SAMPLE_FIELDS,
  SAMPLE_FILE_NAME,
  SAMPLE_MESSAGE,
  SAMPLE_TITLE,
} from '@/lib/sample-envelope';
import { SAMPLE_AGREEMENT_PDF } from './sample/agreement-pdf';
import { apiError } from './sign/api';

type Sql = postgres.Sql;

export interface SampleDeps {
  sql: Sql;
  /** `signRequest` in the app; a stub in tests. */
  request: (principal: Principal, path: `/v1/${string}`, init: RequestInit) => Promise<Response>;
  recordSender: (input: {
    workspaceId: string;
    envelopeId: string;
    userId: string;
  }) => Promise<void>;
}

/** The body that creates the sample draft: our own one-page PDF, the user as the signer. */
export function sampleEnvelopeBody(user: { name: string; email: string }) {
  const name = user.name.trim() || user.email.split('@')[0] || 'You';
  return {
    title: SAMPLE_TITLE,
    message: SAMPLE_MESSAGE,
    documents: [{ key: 'sample', name: SAMPLE_FILE_NAME, content: SAMPLE_AGREEMENT_PDF }],
    recipients: [
      { key: 'me', name, email: user.email, role: 'signer', auth: 'email_link', order: 1 },
    ],
    fields: SAMPLE_FIELDS.map((field) => ({
      document: 'sample',
      recipient: 'me',
      type: field.type,
      page: 0,
      rect: field.rect,
      required: true,
    })),
  };
}

/**
 * Adds a ready draft to a new workspace, so its creator can press Send and sign a document of
 * their own within a minute. The workspace home links to it until it is dismissed.
 */
export async function createSampleEnvelope(
  deps: SampleDeps,
  input: { workspaceId: string; user: { id: string; name: string; email: string } },
): Promise<string> {
  const res = await deps.request(
    { id: `user:${input.user.id}`, workspaceId: input.workspaceId },
    '/v1/envelopes',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleEnvelopeBody(input.user)),
    },
  );
  if (!res.ok) throw await apiError(res);
  const envelope = (await res.json()) as Envelope;
  await deps.recordSender({
    workspaceId: input.workspaceId,
    envelopeId: envelope.id,
    userId: input.user.id,
  });
  await deps.sql`insert into app_first_run (workspace_id, envelope_id)
    values (${input.workspaceId}, ${envelope.id})
    on conflict (workspace_id) do nothing`;
  return envelope.id;
}

export async function isSampleEnvelope(sql: Sql, workspaceId: string, envelopeId: string) {
  const [row] = await sql`select 1 from app_first_run
    where workspace_id = ${workspaceId} and envelope_id = ${envelopeId}`;
  return Boolean(row);
}

/** The sample's envelope id while the "Start here" card is still showing. */
export async function startHere(sql: Sql, workspaceId: string): Promise<string | null> {
  const [row] = await sql<{ envelopeId: string }[]>`
    select envelope_id as "envelopeId" from app_first_run
    where workspace_id = ${workspaceId} and dismissed_at is null`;
  return row?.envelopeId ?? null;
}

export async function dismissStartHere(sql: Sql, workspaceId: string) {
  await sql`update app_first_run set dismissed_at = now()
    where workspace_id = ${workspaceId} and dismissed_at is null`;
}
