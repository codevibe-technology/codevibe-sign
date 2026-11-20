import type { ReactNode } from 'react';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { PageHeader } from '@/components/ui/page-header';
import { settingsTabs } from '@/lib/settings-tabs';
import { requireWorkspace } from '@/server/auth/guards';
import { isHosted } from '@/server/plans';

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { role } = await requireWorkspace(slug);
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsTabs tabs={settingsTabs(slug, role, { plans: isHosted() })} />
      <div className="max-w-3xl space-y-6">{children}</div>
    </>
  );
}
