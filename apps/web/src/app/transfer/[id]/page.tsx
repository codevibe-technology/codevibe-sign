import { ArrowRightLeft, MailX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame, StatusPage } from '@/components/shell/status-page';
import { Button } from '@/components/ui/button';
import { hasPassword } from '@/server/auth/passwords';
import { requireUser, sessionStartedAt } from '@/server/auth/session';
import { RECENT_SIGN_IN_MS } from '@/server/auth/step-up';
import { db } from '@/server/db';
import { getTransfer, recipientRoomProblem } from '@/server/transfers';
import { AcceptTransfer } from './accept-transfer';

export const metadata: Metadata = { title: 'Workspace transfer' };
export const dynamic = 'force-dynamic';

const ENDED: Record<string, string> = {
  accepted: 'This workspace has already moved.',
  declined: 'This offer was declined.',
  cancelled: 'The owner cancelled this offer.',
  expired: 'This offer expired after 7 days.',
};

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/transfer/${id}`;
  const user = await requireUser(here);
  const sql = db();
  const transfer = id.length <= 64 ? await getTransfer(sql, id) : null;
  if (!transfer || transfer.toEmail !== user.email.trim().toLowerCase()) {
    return (
      <StatusPage
        icon={MailX}
        title="This transfer is not for you"
        description={
          <>
            You are signed in as <strong>{user.email}</strong>. Open the link from the email that
            offered you the workspace, signed in with the address it was sent to.
          </>
        }
      />
    );
  }
  if (transfer.status !== 'pending') {
    return (
      <StatusPage
        icon={MailX}
        title={ENDED[transfer.status] ?? 'This offer is closed'}
        description={
          transfer.status === 'accepted' ? (
            'Nothing more to do here.'
          ) : (
            <>
              Nothing has changed. Ask {transfer.fromName ?? 'the owner'} to start a new transfer
              from the workspace settings if it should still move to you.
            </>
          )
        }
        action={
          transfer.status === 'accepted' ? (
            <Button asChild>
              <Link href={`/dashboard/${transfer.workspaceSlug}`}>Open the workspace</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  const [password, started, room] = await Promise.all([
    hasPassword(sql, user.id),
    sessionStartedAt(),
    recipientRoomProblem(sql, user.id),
  ]);
  const recentSignIn = started !== null && Date.now() - started.getTime() <= RECENT_SIGN_IN_MS;
  return (
    <AuthFrame wide>
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-nav text-accent">
        <ArrowRightLeft aria-hidden strokeWidth={1.8} className="h-6 w-6" />
      </span>
      <p className="eyebrow mb-2">Workspace transfer</p>
      <h1 className="text-[26px] leading-tight font-bold">Take over {transfer.workspaceName}?</h1>
      <p className="mt-1.5 mb-6 text-muted">
        {transfer.fromName ?? 'The owner'} offered to move this workspace to your account. You
        become its owner, and your plan pays for it from then on.
      </p>
      <AcceptTransfer
        transfer={{
          id: transfer.id,
          workspaceName: transfer.workspaceName,
          fromName: transfer.fromName ?? 'The owner',
          expiresAt: transfer.expiresAt.toISOString(),
          previousOwnerStays: transfer.previousOwnerStays,
        }}
        confirm={password ? 'password' : recentSignIn ? 'recent-sign-in' : 'sign-in-again'}
        room={room}
        signInHref={`/sign-in?next=${encodeURIComponent(here)}`}
      />
    </AuthFrame>
  );
}
