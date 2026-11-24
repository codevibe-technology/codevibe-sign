'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { auth, lockout, notifyPasswordChanged } from '../auth/auth';
import { createInvitedAccount, setOwnPassword } from '../auth/passwords';
import { db } from '../db';
import { personNameInput } from '../profile';
import { publicAction, userAction } from './action';

const password = z.string({ error: 'Enter a password' }).max(1000);

export const setPasswordAction = userAction(
  z.object({
    currentPassword: password.optional(),
    newPassword: password,
    signOutOthers: z.boolean().optional(),
  }),
  async (user, input) =>
    setOwnPassword(
      { sql: db(), auth: auth(), lockout: lockout(), notify: notifyPasswordChanged },
      user,
      await headers(),
      {
        newPassword: input.newPassword,
        ...(input.currentPassword ? { currentPassword: input.currentPassword } : {}),
        ...(input.signOutOthers ? { signOutOthers: true } : {}),
      },
    ),
);

export const signOutOtherSessionsAction = userAction(z.object({}), async () => {
  await auth().api.revokeOtherSessions({ headers: await headers() });
});

/** Ends every session of the signed-in person, this one included. */
export const signOutEverywhereAction = userAction(z.object({}), async () => {
  await auth().api.revokeSessions({ headers: await headers() });
});

/** For someone opening an invitation without an account: the account, with their password. */
export const joinWithPasswordAction = publicAction(
  z.object({
    token: z.string().min(1).max(100),
    name: personNameInput,
    password,
  }),
  async (input) => createInvitedAccount({ sql: db(), auth: auth() }, input),
);
