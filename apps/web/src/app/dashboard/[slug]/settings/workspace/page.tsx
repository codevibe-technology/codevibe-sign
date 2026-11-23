import type { Metadata } from 'next';
import { WorkspaceForm } from '@/components/settings/workspace-form';
import { WorkspaceTimeZoneForm } from '@/components/settings/workspace-time-zone-form';
import { can } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { defaultTimeZone, env } from '@/server/env';
import { pastAddresses } from '@/server/workspace-address';
import { workspaceTimeZone } from '@/server/workspaces';

export const metadata: Metadata = { title: 'Workspace settings' };

export default async function WorkspaceSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, 'workspace.manage');
  const [own, past] = await Promise.all([
    workspaceTimeZone(db(), workspace.id),
    pastAddresses(db(), workspace.id),
  ]);
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
    </div>
  );
}
