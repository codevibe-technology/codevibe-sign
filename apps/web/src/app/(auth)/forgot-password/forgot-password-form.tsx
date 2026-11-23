'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { authClient } from '@/lib/auth-client';

export function ForgotPasswordForm({ email: initial }: { email: string }) {
  const [email, setEmail] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter your work email, for example asha@company.com');
      return;
    }
    setPending(true);
    setError(undefined);
    const { error: failure } = await authClient.requestPasswordReset({
      email: address,
      redirectTo: '/reset-password',
    });
    setPending(false);
    if (failure) {
      setError(
        failure.status === 429
          ? 'Too many requests. Wait a minute and try again.'
          : 'We could not send the email. Try again in a moment.',
      );
    } else setSentTo(address);
  }

  if (sentTo) {
    return (
      <div className="rounded-lg border border-accent/40 bg-accent-soft p-5" role="status">
        <MailCheck aria-hidden className="mb-2 h-6 w-6" />
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 text-sm">
          If <strong>{sentTo}</strong> has an account, we sent it a link to choose a new password.
          It works once and expires in 30 minutes.
        </p>
        <Link
          href="/sign-in"
          className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Work email" error={error}>
        {(props) => (
          <Input
            {...props}
            type="email"
            name="email"
            autoComplete="username"
            autoFocus
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" pending={pending}>
        {pending ? 'Sending…' : 'Email me a reset link'}
      </Button>
      <p className="text-center text-[13px]">
        <Link href="/sign-in" className="font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
