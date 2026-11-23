export const ROLES = ['viewer', 'member', 'billing', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  billing: 'Billing admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including owners and deleting the workspace.',
  admin: 'Settings, brand, API keys and the team. Not invoices or payments.',
  billing: 'Plan, usage, invoices, credits and renewals, and sends their own documents.',
  member: 'Sends documents and uses templates.',
  viewer: 'Sees documents and their progress.',
};

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

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
  | 'esign.manage'
  | 'owners.manage'
  | 'workspace.delete';

const MEMBER: readonly Permission[] = ['envelopes.read', 'envelopes.write'];
const ADMIN: readonly Permission[] = [
  ...MEMBER,
  'envelopes.voidAny',
  // A link handed out by hand signs as the recipient, so only admins may take one.
  'links.share',
  'workspace.manage',
  'brand.manage',
  'apiKeys.manage',
  'webhooks.manage',
  'team.manage',
  'esign.manage',
];

/**
 * What each role may do. Billing admins are members who also run the account's billing; plain
 * admins run the workspace but not its payments.
 */
const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(['envelopes.read']),
  member: new Set(MEMBER),
  billing: new Set([...MEMBER, 'billing.manage']),
  admin: new Set(ADMIN),
  owner: new Set([...ADMIN, 'billing.manage', 'owners.manage', 'workspace.delete']),
};

/** The one place that decides what a role may do. Pages, actions and the API all ask it. */
export const can = (role: Role, permission: Permission) => GRANTS[role].has(permission);

/**
 * Whether someone may see and pay for the account a workspace is on: its plan, invoices,
 * credits and renewals. The person who holds the account always may; otherwise only a billing
 * admin of the workspace. Other owners and admins of the workspace may not, because the
 * account and its money are not theirs.
 */
export const canManageBilling = (role: Role, holdsAccount: boolean) =>
  holdsAccount || role === 'billing';

/**
 * Whether `actor` may give someone `role`, or change or remove someone who has it. Billing
 * admins reach the account's money, so like owners only an owner names them.
 */
export const canManageRole = (actor: Role, role: Role) =>
  role === 'owner' || role === 'billing' ? can(actor, 'owners.manage') : can(actor, 'team.manage');

/**
 * Members withdraw what they sent; admins and owners withdraw anything in the workspace.
 * `isSender` is false for envelopes created outside the app (API keys).
 */
export const canVoidEnvelope = (role: Role, isSender: boolean) =>
  can(role, 'envelopes.voidAny') || (isSender && can(role, 'envelopes.write'));
