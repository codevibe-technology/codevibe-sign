import { MailX, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame, StatusPage } from '@/components/shell/status-page';
import { Button } from '@/components/ui/button';
import { hasName } from '@/lib/person-name';
import { ROLE_LABELS } from '@/lib/roles';
import { getSessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { findInvitation, invitationState } from '@/server/invitations';
import { hasAccount, needsPassword } from '@/server/auth/passwords';
import { AcceptInvitation } from './accept-invitation';
import { turnstileSiteKey } from '@/server/human-check';
import { JoinForm } from './join-form';

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
    const signIn = `/sign-in?next=${encodeURIComponent(here)}`;
    if (await hasAccount(db(), invitation.email)) {
      return (
        <StatusPage
          icon={Users}
          title={`Join ${invitation.workspaceName}`}
          description={description}
          action={
            <Button asChild>
              <Link href={signIn}>Sign in to accept</Link>
            </Button>
          }
        />
      );
    }
    return (
      <AuthFrame>
        <p className="eyebrow mb-2">Invitation</p>
        <h1 className="text-[26px] leading-tight font-bold">Join {invitation.workspaceName}</h1>
        <p className="mt-1.5 mb-6 text-muted">{description}</p>
        <JoinForm
          token={token}
          email={invitation.email}
          suggestedName={invitation.name ?? ''}
          signInHref={signIn}
          humanCheckKey={turnstileSiteKey()}
        />
      </AuthFrame>
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
      action={
        <AcceptInvitation
          token={token}
          email={user.email}
          askName={!hasName(user)}
          askPassword={await needsPassword(db(), user.id)}
          suggestedName={invitation.name ?? ''}
        />
      }
    />
  );
}
