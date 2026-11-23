import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { ViewerTimeZone } from '@/components/ui/local-time';
import { TransferNotice } from '@/components/workspace/transfer-notice';
import { can } from '@/lib/roles';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { workspaceLogoUrls } from '@/server/brand';
import { getPreferences } from '@/server/preferences';
import { getTours } from '@/server/tours';
import { pendingTransfersFor } from '@/server/transfers';
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
  const [memberships, preferences, offers, tours] = await Promise.all([
    listWorkspacesForUser(db(), access.user.id),
    getPreferences(db(), access.user.id),
    pendingTransfersFor(db(), access.user.email),
    getTours(db(), access.user.id),
  ]);
  const logos = await workspaceLogoUrls(db(), [
    access.workspace.id,
    ...memberships.map((m) => m.workspace.id),
  ]);
  const withLogo = <T extends { id: string }>(workspace: T) => ({
    ...workspace,
    logoUrl: logos.get(workspace.id) ?? null,
  });
  return (
    <AppShell
      user={{ name: access.user.name, email: access.user.email }}
      sidebar={{
        current: withLogo(access.workspace),
        workspaces: memberships.map((m) => withLogo(m.workspace)),
        canCreate: !env().SINGLE_WORKSPACE,
      }}
      tours={{ statuses: tours, canSend: can(access.role, 'envelopes.write') }}
    >
      <ViewerTimeZone zone={preferences.timezone}>
        <TransferNotice
          offers={offers.map((o) => ({
            id: o.id,
            workspaceName: o.workspaceName,
            fromName: o.fromName,
          }))}
        />
        {children}
      </ViewerTimeZone>
    </AppShell>
  );
}
