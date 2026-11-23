import { redirect } from 'next/navigation';
import { APP_HOME } from '@/lib/safe-next';
import { requireUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { listWorkspacesForUser } from '@/server/workspaces';

/** Where everyone lands after signing in: their workspace, or the page that creates one. */
export default async function Dashboard() {
  const user = await requireUser(APP_HOME);
  const [first] = await listWorkspacesForUser(db(), user.id);
  redirect(first ? `${APP_HOME}/${first.workspace.slug}` : '/onboarding');
}
