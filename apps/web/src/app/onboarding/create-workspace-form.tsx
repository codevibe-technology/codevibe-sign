'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { AddressField, blocksSubmit, useAddressCheck } from '@/components/workspace/address-field';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { suggestAddress } from '@/lib/workspace-address';
import { createWorkspaceAction } from '@/server/actions/workspace';

/**
 * The name and the address of a new workspace. The address follows the name until someone
 * edits it, and says while they type whether it is free.
 */
export function CreateWorkspaceForm({ host }: { host: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; slug?: string }>({});
  const [pending, start] = useTransition();
  const check = useAddressCheck(slug);

  function changeName(value: string) {
    setName(value);
    setErrors((e) => ({ ...e, name: undefined }));
    if (!edited) setSlug(value.trim() ? suggestAddress(value) : '');
  }

  function changeSlug(value: string) {
    setSlug(value);
    setEdited(true);
    setErrors((e) => ({ ...e, slug: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setErrors({ name: 'Give the workspace a name' });
      return;
    }
    if (!slug) {
      setErrors({ slug: 'Choose an address for the workspace.' });
      return;
    }
    if (blocksSubmit(check)) return;
    start(async () => {
      const result = await createWorkspaceAction({ name, slug });
      if (result.ok) {
        router.push(`/dashboard/${result.data.slug}`);
        return;
      }
      setErrors(result.field === 'name' ? { name: result.error } : { slug: result.error });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Workspace name" hint="For example Acme HR or Acme Legal." error={errors.name}>
        {(props) => (
          <Input
            {...props}
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => changeName(e.target.value)}
            placeholder="Acme HR"
          />
        )}
      </Field>
      <AddressField
        host={host}
        value={slug}
        onChange={changeSlug}
        check={check}
        error={errors.slug}
      />
      <Button type="submit" className="w-full" pending={pending}>
        {pending ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}
