import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { ViewerTimeZone } from '@/components/ui/local-time';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { getPreferences } from '@/server/preferences';
import { listWorkspacesForUser } from '@/server/workspaces';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await requireWorkspace(slug);
  const [memberships, preferences] = await Promise.all([
    listWorkspacesForUser(db(), access.user.id),
    getPreferences(db(), access.user.id),
  ]);
  return (
    <AppShell
      user={{ name: access.user.name, email: access.user.email }}
      sidebar={{
        current: access.workspace,
        workspaces: memberships.map((m) => m.workspace),
        canCreate: !env().SINGLE_WORKSPACE,
      }}
    >
      <ViewerTimeZone zone={preferences.timezone}>{children}</ViewerTimeZone>
    </AppShell>
  );
}
