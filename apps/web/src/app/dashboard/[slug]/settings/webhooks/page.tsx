import type { Metadata } from 'next';
import { WebhooksPanel } from '@/components/settings/webhooks-panel';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { listWebhooks } from '@/server/webhooks';

export const metadata: Metadata = { title: 'Webhooks' };

export default async function WebhookSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'webhooks.manage');
  const webhooks = await listWebhooks(db(), workspace.id);
  return (
    <WebhooksPanel
      slug={slug}
      workspaceId={workspace.id}
      allowInsecure={env().WEBHOOK_ALLOW_INSECURE}
      webhooks={webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        description: w.description,
        events: w.events,
        enabled: w.enabled,
        lastDelivery: w.lastDelivery
          ? { status: w.lastDelivery.status, at: w.lastDelivery.at.toISOString() }
          : null,
      }))}
    />
  );
}
