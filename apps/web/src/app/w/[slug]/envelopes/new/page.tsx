import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SendFlow } from '@/components/envelopes/send/send-flow';
import { resumeStep, stateFromEnvelope } from '@/lib/send-flow';
import { requireWorkspace } from '@/server/auth/guards';
import { AppError } from '@/server/errors';
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
  const { user, workspace } = await requireWorkspace(slug, 'envelopes.write');
  const me = { name: user.name, email: user.email };
  if (!draft) return <SendFlow slug={slug} workspaceId={workspace.id} me={me} />;

  const envelope = await signApi(userPrincipal(user.id, workspace.id, true))
    .get(draft)
    .catch((err: unknown) => {
      if (err instanceof AppError && err.code === 'NOT_FOUND') notFound();
      throw err;
    });
  if (envelope.status !== 'draft') redirect(`/w/${slug}/envelopes/${envelope.id}`);
  const initial = stateFromEnvelope(envelope);
  return (
    <SendFlow
      slug={slug}
      workspaceId={workspace.id}
      me={me}
      initial={initial}
      initialStep={resumeStep(initial)}
    />
  );
}
