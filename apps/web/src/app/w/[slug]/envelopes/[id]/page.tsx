import { currentRecipients } from '@codevibe_technology/sign-core';
import { ArrowLeft, PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EnvelopeActions } from '@/components/envelopes/envelope-actions';
import {
  CertificateCard,
  DocumentsCard,
  RecipientsCard,
  Timeline,
} from '@/components/envelopes/envelope-detail';
import { StatusPill } from '@/components/envelopes/status-pill';
import { LiveUpdates } from '@/components/live/live-updates';
import { Button } from '@/components/ui/button';
import { formatDateTime, isFinalStatus, isOpen, relativeTime } from '@/lib/envelopes';
import { can, canVoidEnvelope } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { senderOf } from '@/server/envelopes';
import { AppError } from '@/server/errors';
import { signApi, userPrincipal, type SealCheck } from '@/server/sign/api';

export const metadata: Metadata = { title: 'Envelope' };

export default async function EnvelopePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { user, workspace, role } = await requireWorkspace(slug);
  const api = signApi(userPrincipal(user.id, workspace.id, true));
  const envelope = await api.get(id).catch((err: unknown) => {
    if (err instanceof AppError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  const [{ events, chainValid }, certificate, sender] = await Promise.all([
    api.events(id),
    api.certificate(id),
    senderOf(db(), workspace.id, id),
  ]);
  const checks: Record<string, SealCheck | null> = {};
  if (envelope.status === 'completed') {
    await Promise.all(
      envelope.documents.map(async (d) => {
        checks[d.id] = await api.verification(id, d.id).catch(() => null);
      }),
    );
  }
  const canWrite = can(role, 'envelopes.write');
  const open = isOpen(envelope.status);
  const canVoid =
    !isFinalStatus(envelope.status) && canVoidEnvelope(role, sender?.userId === user.id);
  const currentIds = currentRecipients(envelope).map((r) => r.id);

  return (
    <>
      <Link
        href={`/w/${slug}/envelopes`}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Envelopes
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold break-words text-ink">{envelope.title}</h1>
            <StatusPill status={envelope.status} />
            <LiveUpdates workspaceId={workspace.id} envelopeId={envelope.id} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {sender?.name
              ? `Sent by ${sender.name} · `
              : sender
                ? ''
                : 'Created through the API · '}
            {envelope.sentAt
              ? `sent ${formatDateTime(envelope.sentAt)}`
              : `created ${formatDateTime(envelope.createdAt)}`}
            {envelope.expiresAt && open ? ` · expires ${relativeTime(envelope.expiresAt)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {envelope.status === 'draft' && canWrite ? (
            <Button asChild>
              <Link href={`/w/${slug}/envelopes/new?draft=${envelope.id}`}>
                <PenLine aria-hidden className="h-4 w-4" />
                Continue editing
              </Link>
            </Button>
          ) : null}
          <EnvelopeActions
            workspaceId={workspace.id}
            envelope={{ id: envelope.id, title: envelope.title }}
            canRemind={open && canWrite && currentIds.length > 0}
            canVoid={canVoid}
          />
        </div>
      </div>

      {envelope.message ? (
        <blockquote className="mb-6 rounded-xl border-l-4 border-accent bg-surface px-4 py-3 text-sm whitespace-pre-line text-ink shadow-card">
          {envelope.message}
        </blockquote>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-6 lg:col-span-3">
          <RecipientsCard
            workspaceId={workspace.id}
            envelope={envelope}
            currentIds={open ? currentIds : []}
            canRemind={canWrite}
          />
          <DocumentsCard slug={slug} envelope={envelope} checks={checks} />
          <CertificateCard
            certificate={certificate}
            downloadHref={`/w/${slug}/envelopes/${envelope.id}/certificate`}
          />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <Timeline events={events} chainValid={chainValid} envelope={envelope} />
        </div>
      </div>
    </>
  );
}
