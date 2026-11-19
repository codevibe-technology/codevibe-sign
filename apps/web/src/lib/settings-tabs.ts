import { can, type Role } from './roles';

/** The settings sections a role can open, in order. */
export function settingsTabs(slug: string, role: Role) {
  const base = `/w/${slug}/settings`;
  const admin = can(role, 'workspace.manage');
  return [
    ...(admin
      ? [
          { label: 'Workspace', href: `${base}/workspace` },
          { label: 'Brand', href: `${base}/brand` },
          { label: 'Team', href: `${base}/team` },
          { label: 'API keys', href: `${base}/api-keys` },
        ]
      : []),
    { label: 'Personal', href: `${base}/personal` },
  ];
}
