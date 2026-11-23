import type { Metadata } from 'next';
import { PersonalForm } from '@/components/settings/personal-form';
import { requireWorkspace } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getPreferences } from '@/server/preferences';

export const metadata: Metadata = { title: 'Personal settings' };

export default async function PersonalSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user } = await requireWorkspace(slug);
  const preferences = await getPreferences(db(), user.id);
  return <PersonalForm user={{ name: user.name, email: user.email }} preferences={preferences} />;
}
