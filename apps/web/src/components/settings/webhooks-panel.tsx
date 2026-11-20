'use client';

import { ChevronRight, Plus, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/envelopes';
import { MAX_WEBHOOKS, eventsSummary, type DeliveryStatus } from '@/lib/webhooks';
import { createWebhookAction } from '@/server/actions/webhooks';
import { DeliveryPill } from './delivery-pill';
import { useAction } from './use-action';
import { EndpointDialog, SecretDialog } from './webhook-dialogs';

export interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  lastDelivery: { status: DeliveryStatus; at: string } | null;
}

export function WebhooksPanel({
  slug,
  workspaceId,
  webhooks,
  allowInsecure,
}: {
  slug: string;
  workspaceId: string;
  webhooks: WebhookRow[];
  allowInsecure: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [secret, setSecret] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const create = useAction();

  const add = (
    <Button
      onClick={() => {
        create.clear();
        setDialogKey((k) => k + 1);
        setOpen(true);
      }}
      disabled={webhooks.length >= MAX_WEBHOOKS}
    >
      <Plus aria-hidden className="h-4 w-4" /> Add endpoint
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader
          title="Webhooks"
          description="Tell your own systems the moment an envelope is sent, signed, completed or declined. Each event is signed with the endpoint's secret."
          action={webhooks.length ? add : undefined}
        />
        {webhooks.length ? (
          <ul className="divide-y divide-line">
            {webhooks.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/w/${slug}/settings/webhooks/${w.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60"
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${w.enabled ? 'bg-success' : 'bg-line-strong'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-ink">{w.url}</span>
                      {w.enabled ? null : <Badge>Off</Badge>}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {w.description ? `${w.description} · ` : ''}
                      {eventsSummary(w.events)}
                    </p>
                  </div>
                  {w.lastDelivery ? (
                    <span className="hidden items-center gap-2 text-sm text-muted sm:flex">
                      <DeliveryPill status={w.lastDelivery.status} />
                      {relativeTime(w.lastDelivery.at)}
                    </span>
                  ) : (
                    <span className="hidden text-sm text-muted sm:inline">No deliveries yet</span>
                  )}
                  <ChevronRight aria-hidden className="h-4 w-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={Webhook}
              title="No endpoints yet"
              description="Add the URL of your HR system, CRM or a small script, choose the events, and it hears about every envelope as it happens."
              action={add}
            />
          </div>
        )}
      </Card>

      <EndpointDialog
        key={dialogKey}
        open={open}
        onOpenChange={setOpen}
        allowInsecure={allowInsecure}
        pending={create.pending}
        serverErrors={create.errors}
        onSubmit={(input) =>
          create.run(() => createWebhookAction({ workspaceId, ...input }), {
            onSuccess: (data) => {
              setOpen(false);
              setCreatedId(data.id);
              setSecret(data.secret);
            },
          })
        }
      />
      <SecretDialog
        secret={secret}
        onClose={() => {
          setSecret(null);
          if (createdId) router.push(`/w/${slug}/settings/webhooks/${createdId}`);
        }}
      />
    </>
  );
}
