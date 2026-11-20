import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WebhookDetail } from '@/components/settings/webhook-detail';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { getWebhook, listDeliveries } from '@/server/webhooks';

export const metadata: Metadata = { title: 'Webhook' };

export default async function WebhookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { slug, id } = await params;
  const filter = (await searchParams).show === 'problems' ? 'problems' : 'all';
  const { workspace } = await requireWorkspace(slug, 'webhooks.manage');
  const sql = db();
  const webhook = await getWebhook(sql, workspace.id, id);
  if (!webhook) notFound();
  const deliveries = await listDeliveries(sql, workspace.id, webhook.id, {
    ...(filter === 'problems' ? { status: 'problems' as const } : {}),
    limit: 100,
  });
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return (
    <WebhookDetail
      slug={slug}
      workspaceId={workspace.id}
      filter={filter}
      allowInsecure={env().WEBHOOK_ALLOW_INSECURE}
      webhook={{
        id: webhook.id,
        url: webhook.url,
        description: webhook.description,
        events: webhook.events,
        enabled: webhook.enabled,
        lastDelivery: webhook.lastDelivery
          ? { status: webhook.lastDelivery.status, at: webhook.lastDelivery.at.toISOString() }
          : null,
      }}
      deliveries={deliveries.map((d) => ({
        deliveryId: d.deliveryId,
        event: d.event,
        body: d.body,
        status: d.status,
        attempts: d.attempts,
        responseStatus: d.responseStatus,
        error: d.error,
        nextRetryAt: iso(d.nextRetryAt),
        durationMs: d.durationMs,
        createdAt: d.createdAt.toISOString(),
        lastAttemptAt: d.lastAttemptAt.toISOString(),
      }))}
    />
  );
}
