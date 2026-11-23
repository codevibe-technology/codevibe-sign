'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { createWorkspaceAction } from '@/server/actions/workspace';

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await createWorkspaceAction({ name });
      if (result.ok) router.push(`/dashboard/${result.data.slug}`);
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Workspace name" hint="For example Acme HR or Acme Legal." error={error}>
        {(props) => (
          <Input
            {...props}
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme HR"
          />
        )}
      </Field>
      <Button type="submit" className="w-full" pending={pending}>
        {pending ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}
