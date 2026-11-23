'use client';

import { LocalTime } from '@/components/ui/local-time';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DialogClose, DialogContent, DialogRoot } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/field';
import { createApiKeyAction, revokeApiKeyAction } from '@/server/actions/api-keys';
import { useAction } from './use-action';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  createdByName: string | null;
  lastUsedAt: string | null;
}

const when = (iso: string | null) => (iso ? <LocalTime iso={iso} format="day" /> : 'Never');

export function ApiKeysPanel({
  workspaceId,
  apiUrl,
  keys,
}: {
  workspaceId: string;
  apiUrl: string;
  keys: ApiKeyRow[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useAction();
  const revoke = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    create.run(() => createApiKeyAction({ workspaceId, name }), {
      onSuccess: (data) => {
        setCreated(data.key);
        setName('');
      },
    });
  }

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setCreated(null);
      setCopied(false);
      create.clear();
    }
  }

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created);
    setCopied(true);
  }

  const newKey = (
    <Button onClick={() => setOpen(true)}>
      <Plus aria-hidden className="h-4 w-4" /> New API key
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader
          title="API keys"
          description={
            <>
              Let your own systems send documents from this workspace. Send the key as{' '}
              <code className="rounded bg-surface-2 px-1 text-[13px]">Authorization: Bearer …</code>{' '}
              to <code className="rounded bg-surface-2 px-1 text-[13px]">{apiUrl}</code>.
            </>
          }
          action={keys.length ? newKey : undefined}
        />
        {keys.length ? (
          <ul className="divide-y divide-line">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <KeyRound aria-hidden className="h-5 w-5 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{key.name}</p>
                  <p className="text-sm text-muted">
                    <code>{key.prefix}…</code> · created {when(key.createdAt)}
                    {key.createdByName ? ` by ${key.createdByName}` : ''} · last used{' '}
                    {when(key.lastUsedAt)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={revoke.pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke "${key.name}"? Anything using it stops working at once.`,
                      )
                    ) {
                      revoke.run(() => revokeApiKeyAction({ workspaceId, keyId: key.id }), {
                        success: 'Key revoked',
                      });
                    }
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={KeyRound}
              title="No API keys yet"
              description="Create a key for each system that sends documents, so you can revoke one without touching the others."
              action={newKey}
            />
          </div>
        )}
      </Card>

      <DialogRoot open={open} onOpenChange={close}>
        {created ? (
          <DialogContent
            title="Copy your new key"
            description="This is the only time it is shown. Store it in your system's secrets."
          >
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
              <code data-testid="new-key" className="min-w-0 flex-1 truncate px-1 text-sm">
                {created}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void copy()}>
                {copied ? (
                  <Check aria-hidden className="h-4 w-4" />
                ) : (
                  <Copy aria-hidden className="h-4 w-4" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="mt-6 flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </DialogContent>
        ) : (
          <DialogContent
            title="New API key"
            description="Name it after what will use it, for example HR system."
          >
            <form onSubmit={submit} noValidate className="space-y-5">
              <Field label="Name" error={create.errors.name}>
                {(props) => (
                  <Input
                    {...props}
                    autoFocus
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex justify-end gap-3">
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" pending={create.pending}>
                  Create key
                </Button>
              </div>
            </form>
          </DialogContent>
        )}
      </DialogRoot>
    </>
  );
}
