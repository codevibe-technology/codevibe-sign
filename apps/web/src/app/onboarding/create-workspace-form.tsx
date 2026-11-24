'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { UpgradePrompt, type UpgradeLimit } from '@/components/billing/upgrade-prompt';
import { confirmProblem, NewPasswordFields } from '@/components/auth/new-password-fields';
import { AddressField, blocksSubmit, useAddressCheck } from '@/components/workspace/address-field';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { passwordProblem } from '@/lib/password';
import { PERSON_NAME_MAX, personNameProblem } from '@/lib/person-name';
import { suggestAddress } from '@/lib/workspace-address';
import { createWorkspaceAction } from '@/server/actions/workspace';

type Errors = Partial<Record<'yourName' | 'name' | 'slug' | 'password' | 'confirm', string>>;

/**
 * The name and the address of a new workspace. The address follows the name until someone
 * edits it, and says while they type whether it is free. Someone who has saved no name yet is
 * asked for it first, in the same step, and someone who signs in only by emailed link chooses
 * a password last.
 */
export function CreateWorkspaceForm({
  host,
  email,
  askName = false,
  askPassword = false,
}: {
  host: string;
  /** The signed-in person's address, for the password rules and password managers. */
  email: string;
  askName?: boolean;
  askPassword?: boolean;
}) {
  const router = useRouter();
  const [yourName, setYourName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
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
    if (askPassword) {
      const weak = passwordProblem(password, { email, name: askName ? yourName : null });
      const mismatch = weak ? null : confirmProblem(password, confirm);
      if (weak || mismatch) {
        setErrors({
          ...(weak ? { password: weak } : {}),
          ...(mismatch ? { confirm: mismatch } : {}),
        });
        return;
      }
    }
    start(async () => {
      const result = await createWorkspaceAction({
        name,
        slug,
        ...(askName ? { yourName } : {}),
        ...(askPassword ? { password } : {}),
      });
      if (result.ok) {
        router.push(`/dashboard/${result.data.slug}`);
        return;
      }
      if (result.code === 'PLAN_LIMIT') {
        setLimit({ message: result.error, limit: result.limit });
        return;
      }
      const field =
        result.field === 'name' || result.field === 'yourName' || result.field === 'password'
          ? result.field
          : 'slug';
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
      {askPassword ? (
        <fieldset className="space-y-4 border-t border-line pt-4">
          <legend className="sr-only">Your password</legend>
          <div>
            <p className="text-[15px] font-semibold">Set a password for your account</p>
            <p className="mt-0.5 text-[13px] text-muted">
              So you can sign in even when email links are slow. Sign-in links keep working too.
            </p>
          </div>
          {/* Lets a password manager file the new password under the right account. */}
          <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={(value) => {
              setPassword(value);
              setErrors((x) => ({ ...x, password: undefined }));
            }}
            onConfirm={(value) => {
              setConfirm(value);
              setErrors((x) => ({ ...x, confirm: undefined }));
            }}
            account={{ email, name: askName ? yourName : null }}
            errors={{ password: errors.password, confirm: errors.confirm }}
          />
        </fieldset>
      ) : null}
      <Button type="submit" className="w-full" pending={pending}>
        {pending ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}
