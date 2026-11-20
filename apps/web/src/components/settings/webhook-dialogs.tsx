'use client';

import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogRoot } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  ALL_EVENTS,
  DEFAULT_EVENTS,
  WEBHOOK_DESCRIPTION_MAX,
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_URL_MAX,
  webhookProblems,
  type WebhookInput,
} from '@/lib/webhooks';

/** Add or edit an endpoint: URL, a note, and which events it receives. */
export function EndpointDialog({
  open,
  onOpenChange,
  initial,
  allowInsecure,
  pending,
  serverErrors,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WebhookInput;
  allowInsecure: boolean;
  pending: boolean;
  serverErrors: Record<string, string>;
  onSubmit: (input: WebhookInput) => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [events, setEvents] = useState<string[]>(initial?.events ?? DEFAULT_EVENTS);
  const [shown, setShown] = useState(false);
  const all = events.includes(ALL_EVENTS);
  const problems = shown ? webhookProblems({ url, description, events }, { allowInsecure }) : {};
  const errors = { ...problems, ...serverErrors };

  function submit(event: FormEvent) {
    event.preventDefault();
    setShown(true);
    const input = { url, description, events };
    if (Object.keys(webhookProblems(input, { allowInsecure })).length > 0) return;
    onSubmit(input);
  }

  const toggle = (value: string, on: boolean) =>
    setEvents((list) =>
      on ? [...list.filter((e) => e !== value), value] : list.filter((e) => e !== value),
    );

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={initial ? 'Edit endpoint' : 'Add an endpoint'}
        description="Codevibe Sign posts a signed JSON event to this URL when something happens to an envelope."
      >
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field
            label="Endpoint URL"
            hint={
              allowInsecure
                ? 'http:// is allowed on this install, for testing.'
                : 'A public https:// address.'
            }
            error={errors.url}
          >
            {(props) => (
              <Input
                {...props}
                autoFocus
                type="url"
                inputMode="url"
                maxLength={WEBHOOK_URL_MAX}
                placeholder="https://hooks.example.com/codevibe-sign"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Description (optional)"
            hint="What receives it, for example HR system."
            error={errors.description}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={WEBHOOK_DESCRIPTION_MAX}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <fieldset aria-describedby={errors.events ? 'events-error' : undefined}>
            <legend className="text-sm font-semibold">Events</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  [true, 'All events', 'Including ones added later.'],
                  [false, 'Choose events', 'Only what you tick below.'],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={label}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm',
                    all === value ? 'border-primary bg-primary-soft' : 'border-line-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="event-mode"
                    checked={all === value}
                    onChange={() => setEvents(value ? [ALL_EVENTS] : DEFAULT_EVENTS)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block font-semibold">{label}</span>
                    <span className="text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {all ? null : (
              <div className="mt-3 max-h-56 space-y-3 overflow-y-auto rounded-lg border border-line p-3">
                {WEBHOOK_EVENT_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                      {group.label}
                    </p>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      {group.events.map((e) => (
                        <label key={e.value} className="flex items-center gap-2 py-0.5 text-sm">
                          <input
                            type="checkbox"
                            checked={events.includes(e.value)}
                            onChange={(ev) => toggle(e.value, ev.target.checked)}
                            className="accent-[var(--primary)]"
                          />
                          <span>{e.label}</span>
                          <code className="hidden text-xs text-muted sm:inline">{e.value}</code>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {errors.events ? (
              <p id="events-error" role="alert" className="mt-1.5 text-sm text-danger">
                {errors.events}
              </p>
            ) : null}
          </fieldset>
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" pending={pending}>
              {initial ? 'Save' : 'Add endpoint'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

/** Shows a signing secret once, with copy. */
export function SecretDialog({
  secret,
  onClose,
  title = 'Copy the signing secret',
}: {
  secret: string | null;
  onClose: () => void;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <DialogRoot
      open={secret !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent
        title={title}
        description="This is the only time it is shown. Your server uses it to check that each event really came from here."
      >
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
          <code data-testid="webhook-secret" className="min-w-0 flex-1 truncate px-1 text-sm">
            {secret}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!secret) return;
              void navigator.clipboard.writeText(secret).then(() => setCopied(true));
            }}
          >
            {copied ? (
              <Check aria-hidden className="h-4 w-4" />
            ) : (
              <Copy aria-hidden className="h-4 w-4" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          Check the <code className="rounded bg-surface-2 px-1">x-codevibe-signature</code> header
          with{' '}
          <code className="rounded bg-surface-2 px-1">verifyWebhook(secret, header, rawBody)</code>{' '}
          from <code className="rounded bg-surface-2 px-1">@codevibe_technology/sign-client</code>.
        </p>
        <div className="mt-6 flex justify-end">
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
