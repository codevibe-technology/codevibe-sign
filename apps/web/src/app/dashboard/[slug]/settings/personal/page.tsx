import type { Metadata } from 'next';
import { PasswordForm } from '@/components/settings/password-form';
import { PersonalForm } from '@/components/settings/personal-form';
import { requireWorkspace } from '@/server/auth/guards';
import { hasPassword } from '@/server/auth/passwords';
import { db } from '@/server/db';
import { getPreferences } from '@/server/preferences';

export const metadata: Metadata = { title: 'Personal settings' };

export default async function PersonalSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user } = await requireWorkspace(slug);
  const [preferences, password] = await Promise.all([
    getPreferences(db(), user.id),
    hasPassword(db(), user.id),
  ]);
  const account = { name: user.name, email: user.email };
  return (
    <div className="space-y-6">
      <PersonalForm user={account} preferences={preferences} />
      <PasswordForm user={account} hasPassword={password} />
    </div>
  );
}
