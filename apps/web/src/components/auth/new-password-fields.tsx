'use client';

import { PasswordInput } from '@/components/auth/password-input';
import { Field } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { PASSWORD_HINT, passwordStrength } from '@/lib/password';

const BAR = ['', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'] as const;
const TEXT = ['', 'text-danger', 'text-warning', 'text-success-text', 'text-success-text'] as const;

/** Why the repeated password cannot be accepted, or null when it matches. */
export function confirmProblem(password: string, confirm: string): string | null {
  if (!confirm) return 'Type the password again';
  return confirm === password ? null : 'The two passwords do not match';
}

/** A bar and a word for how strong a new password looks, announced as it changes. */
export function PasswordMeter({
  password,
  account,
}: {
  password: string;
  account: { email?: string | null; name?: string | null };
}) {
  const { score, label } = passwordStrength(password, account);
  return (
    <div className="flex items-center gap-3 pt-0.5">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              score >= step ? BAR[score] : 'bg-line',
            )}
          />
        ))}
      </div>
      <p
        className={cn('w-20 text-right text-[12px] font-semibold', TEXT[score])}
        aria-live="polite"
      >
        {label ? <span className="sr-only">Password strength: </span> : null}
        {label}
      </p>
    </div>
  );
}

/**
 * A new password, typed twice, with a strength meter. The rules shown are the same ones the
 * server applies.
 */
export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  account,
  errors = {},
  label = 'Password',
  hint = PASSWORD_HINT,
  autoFocus = false,
}: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  account: { email?: string | null; name?: string | null };
  errors?: { password?: string | undefined; confirm?: string | undefined };
  label?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <>
      <Field label={label} hint={hint} error={errors.password}>
        {(props) => (
          <div className="space-y-1.5">
            <PasswordInput
              {...props}
              name="new-password"
              autoComplete="new-password"
              autoFocus={autoFocus}
              maxLength={1000}
              value={password}
              onChange={(e) => onPassword(e.target.value)}
            />
            <PasswordMeter password={password} account={account} />
          </div>
        )}
      </Field>
      <Field label="Confirm password" error={errors.confirm}>
        {(props) => (
          <PasswordInput
            {...props}
            name="confirm-password"
            autoComplete="new-password"
            maxLength={1000}
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}
