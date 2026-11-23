import { redirect } from 'next/navigation';
import { settingsTabs } from '@/lib/settings-tabs';
import { requireWorkspace } from '@/server/auth/guards';

export default async function SettingsIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await requireWorkspace(slug);
  redirect(settingsTabs(slug, role)[0]!.href);
}
