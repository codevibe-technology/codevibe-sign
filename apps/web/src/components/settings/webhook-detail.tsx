'use client';

import { KeyRound, PenLine, Power, RotateCw, Send, Trash2, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DialogClose, DialogContent, DialogRoot } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/envelopes';
import { deliveryHint, eventsSummary, prettyPayload, type DeliveryStatus } from '@/lib/webhooks';
import type { ActionResult } from '@/server/actions/action';
import {
  deleteWebhookAction,
  retryDeliveryAction,
  rollWebhookSecretAction,
  setWebhookEnabledAction,
  testWebhookAction,
  updateWebhookAction,
} from '@/server/actions/webhooks';
import { DeliveryPill } from './delivery-pill';
import { useAction } from './use-action';
import { EndpointDialog, SecretDialog } from './webhook-dialogs';
import type { WebhookRow } from './webhooks-panel';

export interface DeliveryRow {
  deliveryId: string;
  event: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextRetryAt: string | null;
  durationMs: number | null;
  createdAt: string;
  lastAttemptAt: string;
}

type Outcome = {
  outcome: 'delivered' | 'failed' | 'skipped';
  status: number | null;
  error: string | null;
};

/** A toast that says what the receiver answered. */
export function outcomeMessage(what: string, result: Outcome): { ok: boolean; text: string } {
  if (result.outcome === 'delivered') {
    return { ok: true, text: `${what} delivered: your server answered ${result.status}.` };
  }
  if (result.outcome === 'skipped')
    return { ok: false, text: `${what} not sent: the endpoint is off.` };
  const hint = deliveryHint({
    status: 'failed',
    responseStatus: result.status,
    error: result.error,
  });
  return { ok: false, text: `${what} failed. ${hint ?? ''}`.trim() };
}

export function WebhookDetail({
  slug,
  workspaceId,
  webhook,
  deliveries,
  filter,
  allowInsecure,
}: {
  slug: string;
  workspaceId: string;
  webhook: WebhookRow;
  deliveries: DeliveryRow[];
  filter: 'all' | 'problems';
  allowInsecure: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<DeliveryRow | null>(null);
  const [busy, start] = useTransition();
  const edit = useAction();

  function act<T>(work: () => Promise<ActionResult<T>>, done: (data: T) => void) {
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      done(result.data);
      router.refresh();
    });
  }

  const report = (what: string) => (result: Outcome) => {
    const message = outcomeMessage(what, result);
    if (message.ok) toast.success(message.text);
    else toast.error(message.text);
  };

  const base = `/w/${slug}/settings/webhooks/${webhook.id}`;

  return (
    <>
      <Link
        href={`/w/${slug}/settings/webhooks`}
        className="text-sm font-semibold text-muted hover:text-ink"
      >
        ← All endpoints
      </Link>
      <Card>
        <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Webhook aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
              <span className="break-all">{webhook.url}</span>
              {webhook.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {webhook.description ? `${webhook.description} · ` : ''}
              {eventsSummary(webhook.events)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-3">
          <Button
            size="sm"
            disabled={busy || !webhook.enabled}
            title={webhook.enabled ? undefined : 'Turn the endpoint on first'}
            onClick={() =>
              act(
                () => testWebhookAction({ workspaceId, webhookId: webhook.id }),
                report('Test event'),
              )
            }
          >
            <Send aria-hidden className="h-4 w-4" /> Send test event
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              edit.clear();
              setDialogKey((k) => k + 1);
              setEditing(true);
            }}
          >
            <PenLine aria-hidden className="h-4 w-4" /> Edit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act(
                () =>
                  setWebhookEnabledAction({
                    workspaceId,
                    webhookId: webhook.id,
                    enabled: !webhook.enabled,
                  }),
                () =>
                  toast.success(
                    webhook.enabled ? 'Turned off. Events stop at once.' : 'Turned on.',
                  ),
              )
            }
          >
            <Power aria-hidden className="h-4 w-4" /> {webhook.enabled ? 'Turn off' : 'Turn on'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  'Make a new secret? The current one stops working at once, so update your server straight away.',
                )
              )
                return;
              act(
                () => rollWebhookSecretAction({ workspaceId, webhookId: webhook.id }),
                (data) => setSecret(data.secret),
              );
            }}
          >
            <KeyRound aria-hidden className="h-4 w-4" /> New secret
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger sm:ml-auto"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `Remove ${webhook.url}? It stops receiving events and its log is deleted.`,
                )
              )
                return;
              act(
                () => deleteWebhookAction({ workspaceId, webhookId: webhook.id }),
                () => {
                  toast.success('Endpoint removed.');
                  router.push(`/w/${slug}/settings/webhooks`);
                },
              );
            }}
          >
            <Trash2 aria-hidden className="h-4 w-4" /> Remove
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Deliveries"
          description="The last 30 days. Failed deliveries are retried for about a day; you can also send one again."
          action={
            <nav aria-label="Show" className="flex rounded-lg border border-line-strong p-0.5">
              {(['all', 'problems'] as const).map((value) => (
                <Link
                  key={value}
                  href={value === 'all' ? base : `${base}?show=problems`}
                  aria-current={filter === value ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-sm font-semibold',
                    filter === value ? 'bg-surface-2 text-ink' : 'text-muted',
                  )}
                >
                  {value === 'all' ? 'All' : 'Failed'}
                </Link>
              ))}
            </nav>
          }
        />
        {deliveries.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Send}
              title={filter === 'problems' ? 'No failed deliveries' : 'Nothing delivered yet'}
              description={
                filter === 'problems'
                  ? 'Every delivery in the last 30 days reached your server.'
                  : 'Send a test event, or send an envelope, and deliveries show up here.'
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line" aria-label="Deliveries">
            {deliveries.map((d) => (
              <li key={d.deliveryId}>
                <button
                  type="button"
                  onClick={() => setOpen(d)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left text-sm hover:bg-surface-2/60"
                >
                  <DeliveryPill status={d.status} />
                  <code className="min-w-0 flex-1 truncate font-medium text-ink">{d.event}</code>
                  <span className="w-full text-muted sm:w-auto">
                    {d.responseStatus !== null
                      ? `HTTP ${d.responseStatus}`
                      : d.status === 'delivered'
                        ? ''
                        : 'No answer'}
                    {d.attempts > 1 ? ` · ${d.attempts} attempts` : ''}
                    <span className="sm:ml-3">
                      {d.responseStatus !== null || d.attempts > 1 ? ' · ' : ''}
                      {relativeTime(d.lastAttemptAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DialogRoot open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open ? (
          <DialogContent title={open.event} description={`Delivery ${open.deliveryId}`}>
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted">Status</dt>
                <dd>
                  <DeliveryPill status={open.status} />
                </dd>
                <dt className="text-muted">Answer</dt>
                <dd>
                  {open.responseStatus !== null ? `HTTP ${open.responseStatus}` : 'None'}
                  {open.durationMs !== null ? ` in ${open.durationMs} ms` : ''}
                </dd>
                <dt className="text-muted">Attempts</dt>
                <dd>{open.attempts}</dd>
                <dt className="text-muted">Last tried</dt>
                <dd>{new Date(open.lastAttemptAt).toLocaleString()}</dd>
                {open.nextRetryAt ? (
                  <>
                    <dt className="text-muted">Next try</dt>
                    <dd>{new Date(open.nextRetryAt).toLocaleString()}</dd>
                  </>
                ) : null}
              </dl>
              {deliveryHint(open) ? (
                <p
                  role="note"
                  className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-warning"
                >
                  {deliveryHint(open)}
                </p>
              ) : null}
              <div>
                <p className="mb-1 font-semibold">Payload</p>
                <pre
                  data-testid="payload"
                  className="max-h-72 overflow-auto rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed"
                >
                  {prettyPayload(open.body)}
                </pre>
              </div>
              <div className="flex flex-wrap justify-end gap-3">
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  disabled={busy || !webhook.enabled}
                  pending={busy}
                  onClick={() =>
                    act(
                      () =>
                        retryDeliveryAction({
                          workspaceId,
                          webhookId: webhook.id,
                          deliveryId: open.deliveryId,
                        }),
                      (result) => {
                        report('Delivery')(result);
                        setOpen(null);
                      },
                    )
                  }
                >
                  <RotateCw aria-hidden className="h-4 w-4" /> Send again
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </DialogRoot>

      <EndpointDialog
        key={dialogKey}
        open={editing}
        onOpenChange={setEditing}
        initial={{
          url: webhook.url,
          description: webhook.description ?? '',
          events: webhook.events,
        }}
        allowInsecure={allowInsecure}
        pending={edit.pending}
        serverErrors={edit.errors}
        onSubmit={(input) =>
          edit.run(() => updateWebhookAction({ workspaceId, webhookId: webhook.id, ...input }), {
            success: 'Endpoint saved.',
            onSuccess: () => {
              setEditing(false);
              router.refresh();
            },
          })
        }
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} title="Copy the new secret" />
    </>
  );
}
