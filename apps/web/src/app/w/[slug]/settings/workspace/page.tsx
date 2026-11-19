import type { Metadata } from 'next';
import { WorkspaceForm } from '@/components/settings/workspace-form';
import { requireWorkspace } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Workspace settings' };

export default async function WorkspaceSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'workspace.manage');
  return <WorkspaceForm workspace={workspace} />;
}
