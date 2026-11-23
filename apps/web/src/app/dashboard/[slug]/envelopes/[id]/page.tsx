import { LocalTime } from '@/components/ui/local-time';
import { currentRecipients } from '@codevibe_technology/sign-core';
import { ArrowLeft, PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecallButton, ReviseButton } from '@/components/envelopes/copy-dialogs';
import { DeclineBanner } from '@/components/envelopes/decline-banner';
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
import { isFinalStatus, isOpen } from '@/lib/envelopes';
import { can, canVoidEnvelope } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { senderOf } from '@/server/envelopes';
import { completedCopyMail } from '@/server/mail-log';
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
  const [{ events, chainValid }, certificate, sender, copies] = await Promise.all([
    api.events(id),
    api.certificate(id),
    senderOf(db(), workspace.id, id),
    envelope.status === 'completed'
      ? completedCopyMail(db(), workspace.id, id)
      : ({} as Awaited<ReturnType<typeof completedCopyMail>>),
  ]);
  const copyMail = Object.fromEntries(
    Object.entries(copies).map(([recipientId, m]) => [
      recipientId,
      { status: m.status, at: m.createdAt.toISOString(), error: m.error },
    ]),
  );
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
  // Recalling or revising copies the envelope for whoever may void it.
  const canCopy = canWrite && canVoidEnvelope(role, sender?.userId === user.id);

  return (
    <>
      <Link
        href={`/dashboard/${slug}/envelopes`}
        className="mb-3 inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.1em] text-muted uppercase hover:text-primary"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        Envelopes
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] leading-tight font-bold break-words text-ink md:text-[30px]">
              {envelope.title}
            </h1>
            <StatusPill status={envelope.status} />
            <LiveUpdates workspaceId={workspace.id} envelopeId={envelope.id} />
          </div>
          <p className="mt-1.5 text-sm text-muted">
            {sender?.name
              ? `Sent by ${sender.name} · `
              : sender
                ? ''
                : 'Created through the API · '}
            {envelope.sentAt ? 'sent ' : 'created '}
            <LocalTime iso={envelope.sentAt ?? envelope.createdAt} />
            {envelope.expiresAt && open ? (
              <>
                {' · expires '}
                <LocalTime iso={envelope.expiresAt} />
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {envelope.status === 'draft' && canWrite ? (
            <Button asChild>
              <Link href={`/dashboard/${slug}/envelopes/new?draft=${envelope.id}`}>
                <PenLine aria-hidden className="h-4 w-4" />
                Continue editing
              </Link>
            </Button>
          ) : null}
          {open && canCopy ? (
            <RecallButton
              slug={slug}
              workspaceId={workspace.id}
              envelope={{ id: envelope.id, title: envelope.title }}
            />
          ) : null}
          <EnvelopeActions
            workspaceId={workspace.id}
            envelope={{ id: envelope.id, title: envelope.title }}
            canRemind={open && canWrite && currentIds.length > 0}
            canVoid={canVoid}
          />
        </div>
      </div>

      <DeclineBanner
        envelope={envelope}
        action={
          canCopy ? (
            <ReviseButton slug={slug} workspaceId={workspace.id} envelopeId={envelope.id} />
          ) : null
        }
      />

      {envelope.message ? (
        <blockquote className="mb-6 rounded-lg border border-line border-l-[3px] border-l-accent bg-surface px-4 py-3 text-sm whitespace-pre-line text-ink">
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
            copyMail={copyMail}
            canShareLinks={open && can(role, 'links.share')}
            canCorrect={open && canWrite}
          />
          {can(role, 'workspace.manage') ? (
            <p className="-mt-3 text-right text-sm">
              <Link
                href={`/dashboard/${slug}/settings/email-log?envelope=${encodeURIComponent(envelope.id)}`}
                className="font-medium text-primary hover:underline"
              >
                Emails for this envelope
              </Link>
            </p>
          ) : null}
          <DocumentsCard slug={slug} envelope={envelope} checks={checks} />
          <CertificateCard
            certificate={certificate}
            downloadHref={`/dashboard/${slug}/envelopes/${envelope.id}/certificate`}
          />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <Timeline events={events} chainValid={chainValid} envelope={envelope} slug={slug} />
        </div>
      </div>
    </>
  );
}
