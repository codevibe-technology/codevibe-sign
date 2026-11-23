'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '@/components/auth/password-input';
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAD_EMAIL = 'Enter your work email, for example asha@company.com';

type Mode = 'password' | 'link';

export function SignInForm({
  next,
  google,
  failed,
  notice,
}: {
  next: string;
  google: boolean;
  failed: boolean;
  /** Something that just happened, for example a password that was reset. */
  notice?: string;
}) {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    failed
      ? { email: 'That sign-in link has expired or was already used. Ask for a new one.' }
      : {},
  );
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function switchTo(to: Mode) {
    setMode(to);
    setErrors({});
  }

  async function sendLink(address: string) {
    setPending(true);
    const { error } = await authClient.signIn.magicLink({
      email: address,
      callbackURL: next,
      newUserCallbackURL: next,
      errorCallbackURL: '/sign-in?error=link',
    });
    setPending(false);
    if (error) setErrors({ email: error.message ?? 'We could not send the link. Try again.' });
    else setSentTo(address);
  }

  async function signIn(address: string) {
    if (!password) {
      setErrors({ password: 'Enter your password, or use "Email me a link instead".' });
      return;
    }
    setPending(true);
    const { error } = await authClient.signIn.email({ email: address, password });
    if (!error) {
      // A full page load, so the next page is rendered with the new session.
      window.location.assign(next);
      return;
    }
    setPending(false);
    setErrors({
      password:
        error.status === 429
          ? (error.message ?? 'Too many attempts. Try again in a few minutes.')
          : error.status === 401
            ? 'That email and password do not match. Check them, or use "Email me a link instead".'
            : (error.message ?? 'We could not sign you in. Try again.'),
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setErrors({ email: BAD_EMAIL });
      return;
    }
    setErrors({});
    void (mode === 'link' ? sendLink(address) : signIn(address));
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

  const forgot = `/forgot-password${EMAIL.test(email.trim()) ? `?email=${encodeURIComponent(email.trim())}` : ''}`;

  return (
    <div className="space-y-5">
      {notice ? (
        <p className="rounded-lg border border-accent/40 bg-accent-soft p-3 text-sm" role="status">
          {notice}
        </p>
      ) : null}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Work email" error={errors.email}>
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
        {mode === 'password' ? (
          <div className="space-y-1.5">
            <Field label="Password" error={errors.password}>
              {(props) => (
                <PasswordInput
                  {...props}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <p className="text-right text-[13px]">
              <Link href={forgot} className="font-semibold text-primary hover:underline">
                Forgot password?
              </Link>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            We will email you a link that signs you in. It works once and expires in 10 minutes.
          </p>
        )}
        <Button type="submit" className="w-full" pending={pending}>
          {mode === 'password'
            ? pending
              ? 'Signing in…'
              : 'Sign in'
            : pending
              ? 'Sending link…'
              : 'Email me a sign-in link'}
        </Button>
      </form>
      <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <div className="space-y-3">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => switchTo(mode === 'password' ? 'link' : 'password')}
        >
          {mode === 'password' ? 'Email me a link instead' : 'Use my password instead'}
        </Button>
        {google ? (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              void authClient.signIn.social({
                provider: 'google',
                callbackURL: next,
                newUserCallbackURL: next,
                errorCallbackURL: '/sign-in?error=google',
              })
            }
          >
            <GoogleIcon /> Continue with Google
          </Button>
        ) : null}
      </div>
      <p className="text-center text-[13px] text-muted">
        New here? Use &quot;Email me a link instead&quot;. It creates your account, and you can add
        a password afterwards in your settings.
      </p>
      <p className="text-center text-xs text-muted">
        By signing in you agree to your workspace&apos;s terms of use.
      </p>
    </div>
  );
}
