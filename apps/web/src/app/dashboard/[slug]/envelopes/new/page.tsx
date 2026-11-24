import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { declineOf } from '@/components/envelopes/decline-banner';
import { SendFlow, type RevisionNote } from '@/components/envelopes/send/send-flow';
import { ROLE_OPTIONS } from '@/lib/envelopes';
import { resumeStep, stateFromEnvelope } from '@/lib/send-flow';
import { can } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { esignSendInfo } from '@/server/esign/overview';
import { signApi, userPrincipal } from '@/server/sign/api';

export const metadata: Metadata = { title: 'Send a document' };

export default async function NewEnvelopePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const { slug } = await params;
  const { draft } = await searchParams;
  const { user, workspace, role } = await requireWorkspace(slug, 'envelopes.write');
  const me = { name: user.name, email: user.email };
  const info = await esignSendInfo(db(), workspace.id);
  const esign = {
    available: info.available,
    message: info.message,
    creditsRequired: info.creditsRequired,
    credits: info.credits,
    pricePaise: info.pricePaise,
    sealPosition: info.sealPosition,
    settingsHref: can(role, 'esign.manage') ? `/dashboard/${slug}/settings/aadhaar-esign` : null,
  };
  if (!draft) return <SendFlow slug={slug} workspaceId={workspace.id} me={me} esign={esign} />;

  const api = signApi(userPrincipal(user.id, workspace.id, true));
  const envelope = await api.get(draft).catch((err: unknown) => {
    if (err instanceof AppError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  if (envelope.status !== 'draft') redirect(`/dashboard/${slug}/envelopes/${envelope.id}`);
  const initial = stateFromEnvelope(envelope);
  const revision = await revisionNote(api, draft);
  if (revision) initial.settings.changeNote ??= '';
  return (
    <SendFlow
      slug={slug}
      workspaceId={workspace.id}
      me={me}
      initial={initial}
      initialStep={resumeStep(initial)}
      esign={esign}
      {...(revision ? { revision } : {})}
    />
  );
}

/** For a draft made by Revise and resend: who declined the envelope it revises, and why. */
async function revisionNote(
  api: ReturnType<typeof signApi>,
  draftId: string,
): Promise<RevisionNote | null> {
  const { events } = await api.events(draftId);
  const from = events.find((e) => e.action === 'envelope.created')?.data?.revisedFrom;
  if (typeof from !== 'string') return null;
  const declined = await api.get(from).catch(() => null);
  const decline = declined ? declineOf(declined) : null;
  if (!declined || !decline) return null;
  return {
    title: declined.title,
    declinedBy: decline.name,
    role: ROLE_OPTIONS.find((r) => r.value === decline.role)?.label.toLowerCase() ?? decline.role,
    reason: decline.reason,
  };
}
