'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { renameWorkspaceAction } from '@/server/actions/workspace';
import { ChangeAddressDialog } from './change-address-dialog';
import { useAction } from './use-action';

export function WorkspaceForm({
  workspace,
  host,
  canChangeAddress,
  pastAddresses,
}: {
  workspace: { id: string; name: string; slug: string };
  host: string;
  canChangeAddress: boolean;
  /** Old addresses that still lead here, newest first. */
  pastAddresses: string[];
}) {
  const [name, setName] = useState(workspace.name);
  const { pending, errors, run } = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    run(() => renameWorkspaceAction({ workspaceId: workspace.id, name }), {
      success: 'Workspace name saved',
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Workspace"
          description="The name people see in invitations and the app."
        />
        <CardBody className="space-y-5">
          <Field label="Name" error={errors.name}>
            {(props) => (
              <Input
                {...props}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <div className="space-y-1.5">
            <h3 className="text-[13px] font-semibold text-ink">Address</h3>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="min-w-0 text-[15px] break-all text-ink" data-testid="workspace-address">
                <span className="text-muted">{host}/dashboard/</span>
                <span className="font-semibold">{workspace.slug}</span>
              </p>
              {canChangeAddress ? <ChangeAddressDialog workspace={workspace} host={host} /> : null}
            </div>
            <p className="text-[13px] text-muted">
              {pastAddresses.length
                ? `${pastAddresses.length === 1 ? 'Old address that still leads' : 'Old addresses that still lead'} here: ${pastAddresses.map((slug) => `/dashboard/${slug}`).join(', ')}.`
                : 'The link to this workspace in the app. API keys and webhooks do not use it.'}
            </p>
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={pending} disabled={name.trim() === workspace.name}>
            Save name
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
