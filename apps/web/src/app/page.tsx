import { redirect } from 'next/navigation';
import { requireUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { listWorkspacesForUser } from '@/server/workspaces';

export default async function Home() {
  const user = await requireUser();
  const [first] = await listWorkspacesForUser(db(), user.id);
  redirect(first ? `/w/${first.workspace.slug}` : '/onboarding');
}
