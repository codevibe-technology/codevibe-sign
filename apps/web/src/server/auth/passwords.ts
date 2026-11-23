import 'server-only';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { passwordProblem } from '@/lib/password';
import { AppError } from '../errors';
import { cleanEmail, findInvitation, invitationState } from '../invitations';
import type { Auth } from './auth';
import type { PasswordLockout } from './password-lockout';

type Sql = postgres.Sql | postgres.TransactionSql;

export interface PasswordDeps {
  sql: postgres.Sql;
  auth: Auth;
  lockout: PasswordLockout;
  /** Tells the account's owner by email; failures are the caller's to swallow. */
  notify: (email: string) => Promise<void>;
}

export const NAME_MAX = 80;

/** Whether the person can sign in with a password, or only with an emailed link so far. */
export async function hasPassword(sql: Sql, userId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from auth_accounts
    where user_id = ${userId} and provider_id = 'credential' and password is not null`;
  return Boolean(row);
}

function checked(password: string, account: { email: string; name?: string | null }): string {
  const problem = passwordProblem(password, account);
  if (problem) throw new AppError('VALIDATION', problem, 'newPassword');
  return password;
}

/**
 * Sets the first password on an account, or changes it. Changing needs the current password;
 * wrong ones count towards the same pause as wrong passwords at sign-in. The owner is told by
 * email either way, so a password set from a stolen session does not go unnoticed.
 */
export async function setOwnPassword(
  deps: PasswordDeps,
  user: { id: string; email: string; name: string },
  headers: Headers,
  input: { currentPassword?: string; newPassword: string; signOutOthers?: boolean },
): Promise<{ hadPassword: boolean }> {
  const newPassword = checked(input.newPassword, user);
  const hadPassword = await hasPassword(deps.sql, user.id);
  if (!hadPassword) {
    await deps.auth.api.setPassword({ body: { newPassword }, headers });
    if (input.signOutOthers) await deps.auth.api.revokeOtherSessions({ headers });
  } else {
    const minutes = deps.lockout.lockedFor(user.email);
    if (minutes > 0) {
      throw new AppError(
        'CONFLICT',
        `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
        'currentPassword',
      );
    }
    if (!input.currentPassword) {
      throw new AppError('VALIDATION', 'Enter your current password', 'currentPassword');
    }
    if (input.currentPassword === newPassword) {
      throw new AppError('VALIDATION', 'Choose a password you are not using now', 'newPassword');
    }
    try {
      await deps.auth.api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword,
          revokeOtherSessions: input.signOutOthers === true,
        },
        headers,
      });
    } catch (err) {
      if (!isApiError(err)) throw err;
      deps.lockout.failed(user.email);
      throw new AppError('VALIDATION', 'That is not your current password', 'currentPassword');
    }
    deps.lockout.clear(user.email);
  }
  await deps.notify(user.email);
  return { hadPassword };
}

const isApiError = (err: unknown): err is Error & { status: unknown } =>
  err instanceof Error && err.name === 'APIError';

/**
 * Creates the account for someone opening an invitation who has none yet, with the password
 * they chose. The invitation was emailed to that address, so holding its link confirms the
 * address the same way a sign-in link would. Someone who already has an account signs in
 * instead: an invitation link must never be a way to replace an existing password.
 */
export async function createInvitedAccount(
  deps: Pick<PasswordDeps, 'sql' | 'auth'>,
  input: { token: string; name: string; password: string },
): Promise<{ email: string }> {
  const invitation = await findInvitation(deps.sql, input.token);
  if (!invitation || invitationState(invitation) !== 'open') {
    throw new AppError('NOT_FOUND', 'This invitation is no longer valid. Ask for a new one');
  }
  const email = cleanEmail(invitation.email);
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) throw new AppError('VALIDATION', 'Enter your name', 'name');
  if (name.length > NAME_MAX) {
    throw new AppError('VALIDATION', `Keep the name under ${NAME_MAX} characters`, 'name');
  }
  const password = checked(input.password, { email, name });

  const { password: hasher } = await deps.auth.$context;
  const hash = await hasher.hash(password);
  await deps.sql.begin(async (tx) => {
    const id = randomUUID();
    const created = await tx`
      insert into auth_users (id, name, email, email_verified)
      values (${id}, ${name}, ${email}, true)
      on conflict (email) do nothing
      returning id`;
    if (created.length === 0) {
      throw new AppError(
        'CONFLICT',
        'You already have an account with this email. Sign in to accept the invitation.',
      );
    }
    await tx`
      insert into auth_accounts (id, user_id, account_id, provider_id, password)
      values (${randomUUID()}, ${id}, ${id}, 'credential', ${hash})`;
  });
  return { email };
}
