import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from './auth';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/** The signed-in person for this request, or null. Read once per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth().api.getSession({ headers: await headers() });
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
