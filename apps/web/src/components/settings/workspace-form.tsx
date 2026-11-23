'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { renameWorkspaceAction } from '@/server/actions/workspace';
import { useAction } from './use-action';

export function WorkspaceForm({
  workspace,
}: {
  workspace: { id: string; name: string; slug: string };
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
          <Field label="Address" hint="Fixed when the workspace was created.">
            {(props) => <Input {...props} readOnly value={`/dashboard/${workspace.slug}`} />}
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={pending} disabled={name.trim() === workspace.name}>
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
