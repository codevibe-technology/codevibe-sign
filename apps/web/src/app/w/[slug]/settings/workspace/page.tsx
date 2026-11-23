import type { Metadata } from 'next';
import { WorkspaceForm } from '@/components/settings/workspace-form';
import { WorkspaceTimeZoneForm } from '@/components/settings/workspace-time-zone-form';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { defaultTimeZone, env } from '@/server/env';
import { workspaceTimeZone } from '@/server/workspaces';

export const metadata: Metadata = { title: 'Workspace settings' };

export default async function WorkspaceSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'workspace.manage');
  const own = await workspaceTimeZone(db(), workspace.id);
  return (
    <div className="space-y-6">
      <WorkspaceForm workspace={workspace} />
      <WorkspaceTimeZoneForm
        workspaceId={workspace.id}
        timeZone={own ?? defaultTimeZone(env())}
        chosen={own !== null}
      />
    </div>
  );
}
