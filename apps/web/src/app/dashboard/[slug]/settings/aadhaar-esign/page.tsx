import type { Metadata } from 'next';
import { EsignSettingsPanel } from '@/components/settings/esign-settings';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { esignOverview } from '@/server/esign/overview';

export const metadata: Metadata = { title: 'Aadhaar eSign' };

export default async function EsignSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'esign.manage');
  const overview = await esignOverview(db(), {
    workspaceId: workspace.id,
    appUrl: env().APP_URL,
  });
  return <EsignSettingsPanel workspaceId={workspace.id} slug={slug} overview={overview} />;
}
