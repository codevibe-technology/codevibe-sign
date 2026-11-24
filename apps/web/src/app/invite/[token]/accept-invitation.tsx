'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { confirmProblem, NewPasswordFields } from '@/components/auth/new-password-fields';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { passwordProblem } from '@/lib/password';
import { PERSON_NAME_MAX, personNameProblem } from '@/lib/person-name';
import { acceptInvitationAction } from '@/server/actions/team';

type Errors = Partial<Record<'name' | 'password' | 'confirm', string>>;

/**
 * Accepts the invitation for the signed-in person. Someone who has saved no name yet gives it
 * here, starting from what the inviter typed; someone who signs in only by emailed link also
 * chooses a password, as everyone does before their first workspace.
 */
export function AcceptInvitation({
  token,
  email,
  askName = false,
  askPassword = false,
  suggestedName = '',
}: {
  token: string;
  email: string;
  askName?: boolean;
  askPassword?: boolean;
  suggestedName?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, start] = useTransition();

  function check(): Errors {
    const nameProblem = askName ? personNameProblem(name) : null;
    if (nameProblem) return { name: nameProblem };
    if (!askPassword) return {};
    const weak = passwordProblem(password, { email, name: askName ? name : null });
    if (weak) return { password: weak };
    const mismatch = confirmProblem(password, confirm);
    return mismatch ? { confirm: mismatch } : {};
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    start(async () => {
      const result = await acceptInvitationAction({
        token,
        ...(askName ? { name } : {}),
        ...(askPassword ? { password } : {}),
      });
      if (result.ok) {
        toast.success('Welcome aboard');
        router.push(`/dashboard/${result.data.workspaceSlug}`);
      } else if (result.field === 'name' || result.field === 'password') {
        setErrors({ [result.field]: result.error });
      } else toast.error(result.error);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {askName ? (
        <div className="text-left">
          <Field
            label="Your name"
            hint="Your full name, as the team will see it."
            error={errors.name}
          >
            {(props) => (
              <Input
                {...props}
                name="name"
                autoComplete="name"
                maxLength={PERSON_NAME_MAX}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((x) => ({ ...x, name: undefined }));
                }}
              />
            )}
          </Field>
        </div>
      ) : null}
      {askPassword ? (
        <fieldset className="space-y-4 text-left">
          <legend className="sr-only">Your password</legend>
          <div>
            <p className="text-[15px] font-semibold">Set a password for your account</p>
            <p className="mt-0.5 text-[13px] text-muted">
              So you can sign in even when email links are slow. Sign-in links keep working too.
            </p>
          </div>
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
            account={{ email, name: askName ? name : null }}
            errors={{ password: errors.password, confirm: errors.confirm }}
          />
        </fieldset>
      ) : null}
      <Button type="submit" pending={pending}>
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
    </form>
  );
}
