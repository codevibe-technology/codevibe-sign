import 'server-only';
import type { Envelope, Mailer } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import { declineNotice } from '@/lib/mail-templates';

type Sql = postgres.Sql;

export interface DeclineMailDeps {
  sql: Sql;
  mailer: Mailer;
  appUrl: string;
  load: (envelopeId: string) => Promise<Envelope | null>;
}

/**
 * Tells the member who sent an envelope from the app that it was declined: who, their role
 * and what they wrote, with a link to revise it. Envelopes sent through the API have no such
 * member and get nothing.
 */
export async function mailSenderOnDecline(
  deps: DeclineMailDeps,
  change: { workspaceId: string; envelopeId: string; actions: string[] },
): Promise<void> {
  if (!change.actions.includes('envelope.declined')) return;
  const rows = await deps.sql<{ email: string; name: string; slug: string }[]>`
    select u.email, u.name, w.slug from app_envelope_senders s
    join auth_users u on u.id = s.user_id
    join app_workspaces w on w.id = s.workspace_id
    where s.envelope_id = ${change.envelopeId} and s.workspace_id = ${change.workspaceId}`;
  const sender = rows[0];
  if (!sender) return;
  const envelope = await deps.load(change.envelopeId);
  const decliner = envelope?.recipients.find((r) => r.status === 'declined');
  if (!envelope || !decliner) return;
  const mail = declineNotice({
    senderName: sender.name.trim(),
    title: envelope.title,
    declinedBy: decliner.name,
    role: decliner.role,
    reason: decliner.declineReason ?? null,
    url: `${deps.appUrl}/dashboard/${sender.slug}/envelopes/${encodeURIComponent(envelope.id)}`,
  });
  await deps.mailer.send({
    to: sender.email,
    ...mail,
    meta: {
      kind: 'decline_notice',
      workspaceId: change.workspaceId,
      envelopeId: change.envelopeId,
    },
  });
}
