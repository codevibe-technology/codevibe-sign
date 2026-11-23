import { can, type Role } from './roles';

/** The settings sections a role can open, in order. `plans` adds Plan and usage (hosted cloud). */
export function settingsTabs(slug: string, role: Role, options: { plans?: boolean } = {}) {
  const base = `/dashboard/${slug}/settings`;
  const admin = can(role, 'workspace.manage');
  return [
    ...(admin
      ? [
          { label: 'Workspace', href: `${base}/workspace` },
          { label: 'Brand', href: `${base}/brand` },
          { label: 'Team', href: `${base}/team` },
          { label: 'API keys', href: `${base}/api-keys` },
          { label: 'Webhooks', href: `${base}/webhooks` },
          { label: 'Email log', href: `${base}/email-log` },
        ]
      : []),
    ...(options.plans ? [{ label: 'Plan and usage', href: `${base}/plan` }] : []),
    { label: 'Personal', href: `${base}/personal` },
  ];
}
