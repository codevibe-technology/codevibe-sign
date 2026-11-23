import type { Metadata } from 'next';
import { TeamPanel } from '@/components/settings/team-panel';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { listOpenInvitations } from '@/server/invitations';
import { listMembers } from '@/server/members';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, role, user } = await requireWorkspace(slug, 'team.manage');
  const sql = db();
  const [members, invitations] = await Promise.all([
    listMembers(sql, workspace.id),
    listOpenInvitations(sql, workspace.id),
  ]);
  return (
    <TeamPanel
      workspaceId={workspace.id}
      currentUserId={user.id}
      actorRole={role}
      members={members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }))}
      invitations={invitations.map((i) => ({
        id: i.id,
        email: i.email,
        name: i.name,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
      }))}
    />
  );
}
