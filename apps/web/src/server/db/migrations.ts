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
  {
    name: '0003_envelope_senders',
    sql: `
create table app_envelope_senders (
  envelope_id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  user_id text references auth_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index app_envelope_senders_workspace_idx on app_envelope_senders (workspace_id, user_id);
`,
  },
  {
    name: '0004_templates',
    sql: `
create table app_templates (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  name text not null,
  description text,
  definition jsonb not null,
  created_by text references auth_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index app_templates_workspace_idx on app_templates (workspace_id, archived_at, updated_at desc);

create table app_bulk_sends (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  template_id text not null references app_templates (id) on delete cascade,
  template_name text not null,
  created_by text references auth_users (id) on delete set null,
  status text not null default 'sending' check (status in ('sending', 'done', 'cancelled')),
  total integer not null,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index app_bulk_sends_workspace_idx on app_bulk_sends (workspace_id, created_at desc);
create index app_bulk_sends_open_idx on app_bulk_sends (status) where status = 'sending';

create table app_bulk_send_rows (
  bulk_id text not null references app_bulk_sends (id) on delete cascade,
  line integer not null,
  input jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  envelope_id text,
  error text,
  updated_at timestamptz not null default now(),
  primary key (bulk_id, line)
);
`,
  },
  {
    name: '0005_webhooks',
    sql: `
create table app_webhooks (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  url text not null,
  description text,
  events text[] not null,
  secret text not null,
  enabled boolean not null default true,
  created_by text references auth_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, url)
);

create table app_webhook_deliveries (
  workspace_id text not null references app_workspaces (id) on delete cascade,
  delivery_id text not null,
  webhook_id text not null references app_webhooks (id) on delete cascade,
  url text not null,
  event text not null,
  body text not null,
  status text not null check (status in ('delivered', 'failed', 'retrying', 'skipped')),
  attempts integer not null default 0,
  response_status integer,
  error text,
  next_retry_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  primary key (webhook_id, delivery_id)
);
create index app_webhook_deliveries_webhook_idx
  on app_webhook_deliveries (webhook_id, created_at desc);
create index app_webhook_deliveries_age_idx on app_webhook_deliveries (last_attempt_at);
`,
  },
  {
    name: '0006_plans',
    sql: `
alter table app_workspaces add column plan text not null default 'unlimited'
  check (plan in ('free', 'cloud', 'unlimited'));

create table app_usage (
  workspace_id text not null references app_workspaces (id) on delete cascade,
  metric text not null,
  period text not null,
  used bigint not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, metric, period)
);

create table app_plan_changes (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  from_plan text not null,
  to_plan text not null,
  changed_by text not null,
  created_at timestamptz not null default now()
);
create index app_plan_changes_workspace_idx on app_plan_changes (workspace_id, created_at desc);
`,
  },
  {
    name: '0007_first_run',
    sql: `
create table app_first_run (
  workspace_id text primary key references app_workspaces (id) on delete cascade,
  envelope_id text not null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);
`,
  },
];
