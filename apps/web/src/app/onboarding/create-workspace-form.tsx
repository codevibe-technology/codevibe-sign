'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { UpgradePrompt, type UpgradeLimit } from '@/components/billing/upgrade-prompt';
import { AddressField, blocksSubmit, useAddressCheck } from '@/components/workspace/address-field';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { PERSON_NAME_MAX, personNameProblem } from '@/lib/person-name';
import { suggestAddress } from '@/lib/workspace-address';
import { createWorkspaceAction } from '@/server/actions/workspace';

/**
 * The name and the address of a new workspace. The address follows the name until someone
 * edits it, and says while they type whether it is free. Someone who has saved no name yet is
 * asked for it first, in the same step.
 */
export function CreateWorkspaceForm({
  host,
  askName = false,
}: {
  host: string;
  askName?: boolean;
}) {
  const router = useRouter();
  const [yourName, setYourName] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [errors, setErrors] = useState<{ yourName?: string; name?: string; slug?: string }>({});
  const [limit, setLimit] = useState<{ message: string; limit?: UpgradeLimit | undefined } | null>(
    null,
  );
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
    const nameProblem = askName ? personNameProblem(yourName) : null;
    if (nameProblem) {
      setErrors({ yourName: nameProblem });
      return;
    }
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
      const result = await createWorkspaceAction({
        name,
        slug,
        ...(askName ? { yourName } : {}),
      });
      if (result.ok) {
        router.push(`/dashboard/${result.data.slug}`);
        return;
      }
      if (result.code === 'PLAN_LIMIT') {
        setLimit({ message: result.error, limit: result.limit });
        return;
      }
      const field = result.field === 'name' || result.field === 'yourName' ? result.field : 'slug';
      setErrors({ [field]: result.error });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {limit ? <UpgradePrompt message={limit.message} limit={limit.limit} /> : null}
      {askName ? (
        <Field
          label="Your name"
          hint="Your full name, as your team and the people you send to will see it."
          error={errors.yourName}
        >
          {(props) => (
            <Input
              {...props}
              name="name"
              autoComplete="name"
              autoFocus
              maxLength={PERSON_NAME_MAX}
              value={yourName}
              onChange={(e) => {
                setYourName(e.target.value);
                setErrors((x) => ({ ...x, yourName: undefined }));
              }}
            />
          )}
        </Field>
      ) : null}
      <Field label="Workspace name" hint="For example Acme HR or Acme Legal." error={errors.name}>
        {(props) => (
          <Input
            {...props}
            autoFocus={!askName}
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
