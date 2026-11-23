import type { Metadata } from 'next';
import { MailLogPanel } from '@/components/settings/mail-log-panel';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { listMailLog } from '@/server/mail-log';

export const metadata: Metadata = { title: 'Email log' };

export default async function EmailLogSettings({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ envelope?: string }>;
}) {
  const { slug } = await params;
  const { envelope } = await searchParams;
  const { workspace } = await requireWorkspace(slug, 'workspace.manage');
  const envelopeId =
    typeof envelope === 'string' && envelope.trim() ? envelope.trim().slice(0, 64) : null;
  const rows = await listMailLog(db(), workspace.id, { envelopeId });
  return (
    <MailLogPanel
      slug={slug}
      envelopeId={envelopeId}
      rows={rows.map((r) => ({
        id: r.id,
        envelopeId: r.envelopeId,
        kind: r.kind,
        recipientEmail: r.recipientEmail,
        subject: r.subject,
        providerMessageId: r.providerMessageId,
        status: r.status,
        error: r.error,
        attachmentCount: r.attachmentCount,
        attachmentBytes: r.attachmentBytes,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}
