import type { Metadata } from 'next';
import { PublicRecordsForm } from '@/components/settings/public-records-form';
import { WorkspaceForm } from '@/components/settings/workspace-form';
import { WorkspaceTransfer } from '@/components/settings/workspace-transfer';
import { WorkspaceTimeZoneForm } from '@/components/settings/workspace-time-zone-form';
import { can } from '@/lib/roles';
import { accountOfWorkspace, accountOwnerName } from '@/server/accounts';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { defaultTimeZone, env } from '@/server/env';
import { listOpenInvitations } from '@/server/invitations';
import { listMembers } from '@/server/members';
import { publicRecordsEnabled } from '@/server/public-records';
import { pendingTransferOf, transferHistory } from '@/server/transfers';
import { pastAddresses } from '@/server/workspace-address';
import { workspaceTimeZone } from '@/server/workspaces';

export const metadata: Metadata = { title: 'Workspace settings' };

export default async function WorkspaceSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, role, user } = await requireWorkspace(slug, 'workspace.manage');
  const sql = db();
  const [own, past, records, account, holderName, pending, history, members, invitations] =
    await Promise.all([
      workspaceTimeZone(sql, workspace.id),
      pastAddresses(sql, workspace.id),
      publicRecordsEnabled(sql, workspace.id),
      accountOfWorkspace(sql, workspace.id),
      accountOwnerName(sql, workspace.id),
      pendingTransferOf(sql, workspace.id),
      transferHistory(sql, workspace.id),
      listMembers(sql, workspace.id),
      listOpenInvitations(sql, workspace.id),
    ]);
  const canTransfer = role === 'owner' && account.ownerUserId === user.id;
  return (
    <div className="space-y-6">
      <WorkspaceForm
        workspace={workspace}
        host={new URL(env().APP_URL).host}
        canChangeAddress={can(role, 'workspace.manage')}
        pastAddresses={past.map((entry) => entry.slug)}
      />
      <WorkspaceTimeZoneForm
        workspaceId={workspace.id}
        timeZone={own ?? defaultTimeZone(env())}
        chosen={own !== null}
      />
      <PublicRecordsForm workspaceId={workspace.id} enabled={records} />
      <WorkspaceTransfer
        workspace={workspace}
        canTransfer={canTransfer}
        holderName={holderName}
        pending={
          pending
            ? {
                toEmail: pending.toEmail,
                expiresAt: pending.expiresAt.toISOString(),
                previousOwnerStays: pending.previousOwnerStays,
              }
            : null
        }
        members={[
          ...members
            .filter((m) => m.userId !== account.ownerUserId)
            .map((m) => ({ email: m.email, name: m.name || m.email })),
          ...invitations.map((i) => ({ email: i.email, name: i.name ?? `${i.email} (invited)` })),
        ]}
        history={history}
      />
    </div>
  );
}
