import type { Metadata } from 'next';
import { EsignSettingsPanel } from '@/components/settings/esign-settings';
import { accountOwnerName, isAccountOwner } from '@/server/accounts';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { esignOverview } from '@/server/esign/overview';

export const metadata: Metadata = { title: 'Aadhaar eSign' };

export default async function EsignSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, user } = await requireWorkspace(slug, 'esign.manage');
  const sql = db();
  const canManage = await isAccountOwner(sql, workspace.id, user.id);
  const overview = await esignOverview(sql, {
    workspaceId: workspace.id,
    appUrl: env().APP_URL,
    wholeAccount: canManage,
  });
  return (
    <EsignSettingsPanel
      workspaceId={workspace.id}
      slug={slug}
      overview={overview}
      canManage={canManage}
      managedBy={canManage ? null : await accountOwnerName(sql, workspace.id)}
    />
  );
}
