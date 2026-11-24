import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '../db';
import { appSessionPolicy, env } from '../env';
import { auth } from './auth';
import { keepSessionActive } from './session-activity';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

type FoundSession = NonNullable<Awaited<ReturnType<ReturnType<typeof auth>['api']['getSession']>>>;

/**
 * The session behind these request headers, held to the idle and lifetime limits, with the
 * request counted as activity. Null when there is none or it has run out. Everything that
 * reads a person's session goes through here: pages, actions, route handlers and the API.
 */
export async function activeSession(requestHeaders: Headers): Promise<FoundSession | null> {
  const found = await auth().api.getSession({ headers: requestHeaders });
  if (!found) return null;
  const { token, createdAt, updatedAt, expiresAt } = found.session;
  const live = await keepSessionActive(db(), appSessionPolicy(env()), {
    token,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    expiresAt: new Date(expiresAt),
  });
  return live ? found : null;
}

const currentSession = cache(async () => activeSession(await headers()));

/** The signed-in person for this request, or null. Read once per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await currentSession();
  if (!session) return null;
  const { id, name, email, image } = session.user;
  return { id, name, email, image: image ?? null };
});

/** For pages: the signed-in person, or a redirect to sign-in that comes back here afterwards. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : '/sign-in');
  }
  return user;
}

/** The signed-in visitor of a public page, for its header; null for everyone else. */
export async function siteViewer(): Promise<{ name: string; email: string } | null> {
  const user = await getSessionUser();
  return user ? { name: user.name, email: user.email } : null;
}

/** When the current session was signed in, for checks that need a recent sign-in. */
export async function sessionStartedAt(): Promise<Date | null> {
  const session = await currentSession();
  return session ? new Date(session.session.createdAt) : null;
}
