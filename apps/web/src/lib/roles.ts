export const ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including owners and deleting the workspace.',
  admin: 'Settings, brand, API keys and the team.',
  member: 'Sends documents and uses templates.',
  viewer: 'Sees documents and their progress.',
};

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

const rank = (role: Role) => ROLES.indexOf(role);

export const atLeast = (role: Role, minimum: Role) => rank(role) >= rank(minimum);

export type Permission =
  | 'envelopes.read'
  | 'envelopes.write'
  | 'envelopes.voidAny'
  | 'links.share'
  | 'workspace.manage'
  | 'brand.manage'
  | 'apiKeys.manage'
  | 'webhooks.manage'
  | 'team.manage'
  | 'billing.manage'
  | 'owners.manage'
  | 'workspace.delete';

const MINIMUM: Record<Permission, Role> = {
  'envelopes.read': 'viewer',
  'envelopes.write': 'member',
  'envelopes.voidAny': 'admin',
  // A link handed out by hand signs as the recipient, so only admins may take one.
  'links.share': 'admin',
  'workspace.manage': 'admin',
  'brand.manage': 'admin',
  'apiKeys.manage': 'admin',
  'webhooks.manage': 'admin',
  'team.manage': 'admin',
  'billing.manage': 'admin',
  'owners.manage': 'owner',
  'workspace.delete': 'owner',
};

/** The one place that decides what a role may do. Pages, actions and the API all ask it. */
export const can = (role: Role, permission: Permission) => atLeast(role, MINIMUM[permission]);

/** Whether `actor` may give someone `role`, or change or remove someone who has it. */
export const canManageRole = (actor: Role, role: Role) =>
  role === 'owner' ? can(actor, 'owners.manage') : can(actor, 'team.manage');

/**
 * Members withdraw what they sent; admins and owners withdraw anything in the workspace.
 * `isSender` is false for envelopes created outside the app (API keys).
 */
export const canVoidEnvelope = (role: Role, isSender: boolean) =>
  can(role, 'envelopes.voidAny') || (isSender && can(role, 'envelopes.write'));
