import type { Metadata } from 'next';
import { ApiKeysPanel } from '@/components/settings/api-keys-panel';
import { listApiKeys } from '@/server/api-keys';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { env } from '@/server/env';

export const metadata: Metadata = { title: 'API keys' };

export default async function ApiKeySettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'apiKeys.manage');
  const keys = await listApiKeys(db(), workspace.id);
  return (
    <ApiKeysPanel
      workspaceId={workspace.id}
      apiUrl={`${env().APP_URL}/api/v1`}
      keys={keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        createdAt: k.createdAt.toISOString(),
        createdByName: k.createdByName,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      }))}
    />
  );
}
