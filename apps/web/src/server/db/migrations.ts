export interface AppMigration {
  name: string;
  sql: string;
}

/**
 * The app's schema, applied in order after the sign server's own migrations. Append only:
 * never change a migration once it has been released.
 */
export const appMigrations: readonly AppMigration[] = [
  {
    name: '0001_auth',
    sql: `
create table auth_users (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_sessions (
  id text primary key,
  user_id text not null references auth_users (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_sessions_user_idx on auth_sessions (user_id);

create table auth_accounts (
  id text primary key,
  user_id text not null references auth_users (id) on delete cascade,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_accounts_user_idx on auth_accounts (user_id);

create table auth_verifications (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_verifications_identifier_idx on auth_verifications (identifier);
`,
  },
  {
    name: '0002_workspaces',
    sql: `
create table app_workspaces (
  id text primary key,
  slug text not null unique,
  name text not null,
  created_by text references auth_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_members (
  workspace_id text not null references app_workspaces (id) on delete cascade,
  user_id text not null references auth_users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index app_members_user_idx on app_members (user_id);

create table app_invitations (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  token_hash text not null unique,
  invited_by text references auth_users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index app_invitations_workspace_idx on app_invitations (workspace_id, created_at desc);
create unique index app_invitations_open_idx on app_invitations (workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table app_brand_settings (
  workspace_id text primary key references app_workspaces (id) on delete cascade,
  logo_content_type text,
  logo_updated_at timestamptz,
  brand_color text,
  font text check (font in ('inter', 'space-grotesk', 'system', 'serif')),
  sender_name text,
  reply_to text,
  email_overrides jsonb not null default '{}'::jsonb,
  signing_domain text unique,
  signing_domain_verified_at timestamptz,
  certificate_footer text,
  show_badge boolean not null default true,
  updated_at timestamptz not null default now()
);

create table app_api_keys (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  prefix text not null,
  created_by text references auth_users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index app_api_keys_workspace_idx on app_api_keys (workspace_id, created_at desc);

create table app_user_preferences (
  user_id text primary key references auth_users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  timezone text,
  locale text not null default 'en',
  updated_at timestamptz not null default now()
);
`,
  },
];
