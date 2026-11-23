'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { PASSWORD_HINT, passwordProblem } from '@/lib/password';
import { setPasswordAction, signOutOtherSessionsAction } from '@/server/actions/account';
import { useAction } from './use-action';

/** Set a first password, or change it, and sign the account out everywhere else. */
export function PasswordForm({
  user,
  hasPassword: initial,
}: {
  user: { name: string; email: string };
  hasPassword: boolean;
}) {
  const [hasPassword, setHasPassword] = useState(initial);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [local, setLocal] = useState<string>();
  const { pending, errors, run, clear } = useAction();
  const sessions = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(next, user);
    setLocal(problem ?? undefined);
    if (problem) return;
    clear();
    run(
      () =>
        setPasswordAction({
          newPassword: next,
          ...(hasPassword ? { currentPassword: current } : {}),
          signOutOthers,
        }),
      {
        onSuccess: (data) => {
          toast.success(data.hadPassword ? 'Password changed' : 'Password set');
          setHasPassword(true);
          setCurrent('');
          setNext('');
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} noValidate>
        <Card>
          <CardHeader
            title="Password"
            description={
              hasPassword
                ? 'Sign in with your email and this password. The emailed link keeps working too.'
                : 'You sign in with an emailed link. Add a password to sign in without waiting for an email.'
            }
          />
          <CardBody className="space-y-5">
            {/* Lets a password manager file the new password under the right account. */}
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={user.email}
              readOnly
              hidden
            />
            {hasPassword ? (
              <Field label="Current password" error={errors.currentPassword}>
                {(props) => (
                  <PasswordInput
                    {...props}
                    name="current-password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            <Field
              label={hasPassword ? 'New password' : 'Password'}
              hint={PASSWORD_HINT}
              error={local ?? errors.newPassword}
            >
              {(props) => (
                <PasswordInput
                  {...props}
                  name="new-password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              )}
            </Field>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={signOutOthers}
                onChange={(e) => setSignOutOthers(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span>
                Sign out my other devices
                <span className="block text-[13px] text-muted">
                  This device stays signed in. We email you whenever your password changes.
                </span>
              </span>
            </label>
          </CardBody>
          <CardFooter>
            <Button type="submit" pending={pending}>
              {hasPassword ? 'Change password' : 'Set password'}
            </Button>
          </CardFooter>
        </Card>
      </form>
      <Card>
        <CardHeader
          title="Sessions"
          description="Signed in on a device you no longer use? Sign out everywhere except here."
          action={
            <Button
              variant="secondary"
              pending={sessions.pending}
              onClick={() =>
                sessions.run(() => signOutOtherSessionsAction({}), {
                  success: 'Signed out on your other devices',
                })
              }
            >
              Sign out other sessions
            </Button>
          }
        />
      </Card>
    </div>
  );
}
