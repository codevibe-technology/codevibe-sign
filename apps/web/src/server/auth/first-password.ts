import 'server-only';
import { headers } from 'next/headers';
import { db } from '../db';
import { auth, lockout, notifyPasswordChanged } from './auth';
import { setOwnPassword } from './passwords';

/**
 * Saves the first password of the signed-in person, already checked by `choosePassword`, on
 * their current session, and tells them by email.
 */
export async function setFirstPassword(
  user: { id: string; email: string; name: string },
  newPassword: string,
): Promise<void> {
  await setOwnPassword(
    { sql: db(), auth: auth(), lockout: lockout(), notify: notifyPasswordChanged },
    user,
    await headers(),
    { newPassword },
  );
}
