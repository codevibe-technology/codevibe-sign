import 'server-only';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { passwordProblem } from '@/lib/password';
import { AppError } from '../errors';
import { cleanEmail, findInvitation, invitationState } from '../invitations';
import { cleanPersonName } from '../profile';
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

/** Whether the person can sign in with a password, or only with an emailed link so far. */
export async function hasPassword(sql: Sql, userId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from auth_accounts
    where user_id = ${userId} and provider_id = 'credential' and password is not null`;
  return Boolean(row);
}

/**
 * Whether the person must choose a password before they create or join a workspace: they
 * have none and sign in only by emailed link. Someone who signs in with Google already has a
 * way in that does not wait for an email, so they are not asked.
 */
export async function needsPassword(sql: Sql, userId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from auth_accounts
    where user_id = ${userId} and (provider_id <> 'credential' or password is not null)`;
  return !row;
}

/**
 * The password to set for someone who `needsPassword`, checked against the password rules;
 * null when they need none. A missing or weak one is an error on the `password` field, raised
 * before anything else in the step is saved.
 */
export async function choosePassword(
  sql: Sql,
  user: { id: string; email: string; name: string },
  password: string | undefined,
): Promise<string | null> {
  if (!(await needsPassword(sql, user.id))) return null;
  if (!password) {
    throw new AppError('VALIDATION', 'Choose a password for your account', 'password');
  }
  const problem = passwordProblem(password, user);
  if (problem) throw new AppError('VALIDATION', problem, 'password');
  return password;
}

/** Whether anyone has an account with this address. */
export async function hasAccount(sql: Sql, email: string): Promise<boolean> {
  const [row] = await sql`select 1 from auth_users where lower(email) = ${cleanEmail(email)}`;
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
  const name = cleanPersonName(input.name);
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
