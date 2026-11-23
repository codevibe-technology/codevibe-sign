'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { authClient } from '@/lib/auth-client';
import { PASSWORD_HINT, passwordProblem } from '@/lib/password';
import { joinWithPasswordAction } from '@/server/actions/account';
import { acceptInvitationAction } from '@/server/actions/team';

type Errors = Partial<Record<'name' | 'password' | 'form', string>>;

/**
 * For someone invited who has no account yet: their name and a password. The invitation was
 * emailed to them, so it confirms the address; the account is created, signed in and joined
 * to the workspace in one go.
 */
export function JoinForm({
  token,
  email,
  signInHref,
}: {
  token: string;
  email: string;
  signInHref: string;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  async function join(): Promise<Errors | null> {
    const created = await joinWithPasswordAction({ token, name, password });
    if (!created.ok) {
      const field = created.field === 'newPassword' ? 'password' : created.field;
      return { [field === 'name' || field === 'password' ? field : 'form']: created.error };
    }
    const signedIn = await authClient.signIn.email({ email: created.data.email, password });
    if (signedIn.error) {
      return { form: 'Your account is ready. Sign in with your new password to accept.' };
    }
    const accepted = await acceptInvitationAction({ token });
    if (!accepted.ok) return { form: accepted.error };
    window.location.assign(`/dashboard/${accepted.data.workspaceSlug}`);
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setErrors({ name: 'Enter your name' });
      return;
    }
    const problem = passwordProblem(password, { email, name });
    if (problem) {
      setErrors({ password: problem });
      return;
    }
    setPending(true);
    setErrors({});
    const failed = await join();
    if (failed) {
      setErrors(failed);
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Email" hint="The invitation was sent to this address.">
        {(props) => (
          <Input
            {...props}
            type="email"
            name="email"
            autoComplete="username"
            readOnly
            value={email}
          />
        )}
      </Field>
      <Field label="Your name" error={errors.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            autoComplete="name"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="Choose a password" hint={PASSWORD_HINT} error={errors.password}>
        {(props) => (
          <PasswordInput
            {...props}
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {errors.form ? (
        <p className="text-[13px] text-danger" role="alert">
          {errors.form}
        </p>
      ) : null}
      <Button type="submit" className="w-full" pending={pending}>
        {pending ? 'Joining…' : 'Create account and join'}
      </Button>
      <p className="text-center text-[13px] text-muted">
        Already have an account?{' '}
        <Link href={signInHref} className="font-semibold text-primary hover:underline">
          Sign in to accept
        </Link>
      </p>
    </form>
  );
}
