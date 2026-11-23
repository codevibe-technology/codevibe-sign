'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { authClient } from '@/lib/auth-client';
import { PASSWORD_HINT, passwordProblem } from '@/lib/password';

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(undefined);
    const { error: failure } = await authClient.resetPassword({ newPassword: password, token });
    if (!failure) {
      window.location.assign('/sign-in?reset=1');
      return;
    }
    setPending(false);
    if (failure.code === 'WEAK_PASSWORD' && failure.message) setError(failure.message);
    else if (failure.status === 429) setError('Too many attempts. Wait a minute and try again.');
    else setExpired(true);
  }

  if (expired) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger-soft p-5" role="alert">
        <p className="font-semibold">This link no longer works</p>
        <p className="mt-1 text-sm">
          A reset link works once and expires after 30 minutes. Your password was not changed.
        </p>
        <Link
          href="/forgot-password"
          className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          Send a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="New password" hint={PASSWORD_HINT} error={error}>
        {(props) => (
          <PasswordInput
            {...props}
            name="new-password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" pending={pending}>
        {pending ? 'Saving…' : 'Save new password'}
      </Button>
    </form>
  );
}
