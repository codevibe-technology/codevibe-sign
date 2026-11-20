'use client';

import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { authClient } from '@/lib/auth-client';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.3 6.6 2.3 12s4.3 9.8 9.7 9.8c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}

export function SignInForm({
  next,
  google,
  failed,
}: {
  next: string;
  google: boolean;
  failed: boolean;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(
    failed ? 'That sign-in link has expired or was already used. Ask for a new one.' : undefined,
  );
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
    const { error: failure } = await authClient.signIn.magicLink({
      email: address,
      callbackURL: next,
      newUserCallbackURL: next === '/' ? '/onboarding' : next,
      errorCallbackURL: '/sign-in?error=link',
    });
    setPending(false);
    if (failure) setError(failure.message ?? 'We could not send the link. Try again.');
    else setSentTo(address);
  }

  if (sentTo) {
    return (
      <div className="rounded-lg border border-accent/40 bg-accent-soft p-5" role="status">
        <MailCheck aria-hidden className="mb-2 h-6 w-6" />
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 text-sm">
          We sent a sign-in link to <strong>{sentTo}</strong>. It works once and expires in 10
          minutes.
        </p>
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-primary underline-offset-2 hover:underline"
          onClick={() => setSentTo(null)}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Work email" error={error}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" pending={pending}>
          {pending ? 'Sending link…' : 'Email me a sign-in link'}
        </Button>
      </form>
      {google ? (
        <>
          <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              void authClient.signIn.social({
                provider: 'google',
                callbackURL: next,
                newUserCallbackURL: next === '/' ? '/onboarding' : next,
                errorCallbackURL: '/sign-in?error=google',
              })
            }
          >
            <GoogleIcon /> Continue with Google
          </Button>
        </>
      ) : null}
      <p className="text-center text-xs text-muted">
        By signing in you agree to your workspace&apos;s terms of use.
      </p>
    </div>
  );
}
