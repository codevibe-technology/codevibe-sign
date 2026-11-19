import { MailX, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusPage } from '@/components/shell/status-page';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS } from '@/lib/roles';
import { getSessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { findInvitation, invitationState } from '@/server/invitations';
import { AcceptInvitation } from './accept-invitation';

export const metadata: Metadata = { title: 'Invitation' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await findInvitation(db(), token);
  if (!invitation || invitationState(invitation) !== 'open') {
    return (
      <StatusPage
        icon={MailX}
        title="This invitation is no longer valid"
        description="It may have expired, been used already or been withdrawn. Ask the person who invited you to send a new one."
      />
    );
  }
  const user = await getSessionUser();
  const here = `/invite/${token}`;
  const description = (
    <>
      {invitation.invitedByName ?? 'Someone'} invited <strong>{invitation.email}</strong> to join{' '}
      <strong>{invitation.workspaceName}</strong> as {ROLE_LABELS[invitation.role].toLowerCase()}.
    </>
  );
  if (!user) {
    return (
      <StatusPage
        icon={Users}
        title={`Join ${invitation.workspaceName}`}
        description={description}
        action={
          <Button asChild>
            <Link href={`/sign-in?next=${encodeURIComponent(here)}`}>Sign in to accept</Link>
          </Button>
        }
      />
    );
  }
  if (user.email.toLowerCase() !== invitation.email) {
    return (
      <StatusPage
        icon={MailX}
        title="This invitation is for another email"
        description={
          <>
            You are signed in as <strong>{user.email}</strong>, but the invitation was sent to{' '}
            <strong>{invitation.email}</strong>. Sign out and sign in with that address.
          </>
        }
      />
    );
  }
  return (
    <StatusPage
      icon={Users}
      title={`Join ${invitation.workspaceName}`}
      description={description}
      action={<AcceptInvitation token={token} />}
    />
  );
}
