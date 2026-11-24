'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { confirmProblem, NewPasswordFields } from '@/components/auth/new-password-fields';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { passwordProblem } from '@/lib/password';
import { announceSignOut } from '@/lib/session-sync';
import {
  setPasswordAction,
  signOutEverywhereAction,
  signOutOtherSessionsAction,
} from '@/server/actions/account';
import { useAction } from './use-action';

/**
 * Set a first password, or change it; sign the account out everywhere else, or everywhere
 * including here.
 */
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
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState<string>();
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [local, setLocal] = useState<string>();
  const { pending, errors, run, clear } = useAction();
  const sessions = useAction();
  const everywhere = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(next, user);
    setLocal(problem ?? undefined);
    const different = problem ? null : confirmProblem(next, confirm);
    setMismatch(different ?? undefined);
    if (problem || different) return;
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
          setConfirm('');
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
            <NewPasswordFields
              label={hasPassword ? 'New password' : 'Password'}
              password={next}
              confirm={confirm}
              onPassword={setNext}
              onConfirm={(value) => {
                setConfirm(value);
                setMismatch(undefined);
              }}
              account={user}
              errors={{ password: local ?? errors.newPassword, confirm: mismatch }}
            />
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
          description="Signed in on a device you no longer use, or think someone else might be? Sign out there from here."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Sign out of other devices
              <span className="block text-[13px] text-muted">This device stays signed in.</span>
            </p>
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
          </div>
          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Sign out of all devices
              <span className="block text-[13px] text-muted">
                Every session ends, this one too. You sign in again here afterwards.
              </span>
            </p>
            <DialogRoot>
              <DialogTrigger asChild>
                <Button variant="secondary">Sign out of all devices</Button>
              </DialogTrigger>
              <DialogContent
                title="Sign out of all devices?"
                description="Every browser and device signed in to your account is signed out, including this one."
              >
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <DialogClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </DialogClose>
                  <Button
                    variant="danger"
                    pending={everywhere.pending}
                    onClick={() =>
                      everywhere.run(() => signOutEverywhereAction({}), {
                        onSuccess: () => {
                          announceSignOut('chosen');
                          window.location.assign('/sign-in');
                        },
                      })
                    }
                  >
                    Sign out everywhere
                  </Button>
                </div>
              </DialogContent>
            </DialogRoot>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
