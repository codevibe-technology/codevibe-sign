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
  {
    name: '0008_mail_log',
    sql: `
create table app_mail_log (
  id text primary key,
  workspace_id text references app_workspaces (id) on delete cascade,
  envelope_id text,
  recipient_id text,
  kind text not null,
  recipient_email text not null,
  subject text not null,
  provider_message_id text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  attachment_count integer not null default 0,
  attachment_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);
create index app_mail_log_workspace_idx on app_mail_log (workspace_id, created_at desc);
create index app_mail_log_envelope_idx on app_mail_log (envelope_id, created_at desc)
  where envelope_id is not null;
create index app_mail_log_created_idx on app_mail_log (created_at);
`,
  },
  {
    name: '0009_workspace_time_zone',
    sql: `
alter table app_workspaces add column time_zone text;
`,
  },
  {
    name: '0010_workspace_addresses',
    sql: `
create table app_workspace_slug_history (
  slug text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  retired_at timestamptz not null default now()
);
create index app_workspace_slug_history_workspace_idx
  on app_workspace_slug_history (workspace_id, retired_at desc);

create table app_workspace_address_changes (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  from_slug text not null,
  to_slug text not null,
  changed_by text references auth_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index app_workspace_address_changes_workspace_idx
  on app_workspace_address_changes (workspace_id, created_at desc);
`,
  },
  {
    name: '0011_invitation_names',
    sql: `
alter table app_invitations add column name text;
`,
  },
  {
    name: '0012_public_records',
    sql: `
alter table app_workspaces add column public_records boolean not null default true;

create table app_public_records (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  envelope_id text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text references auth_users (id) on delete set null
);
create index app_public_records_workspace_idx on app_public_records (workspace_id);
`,
  },
  {
    name: '0013_billing',
    sql: `
create table app_audit_log (
  id text primary key,
  workspace_id text references app_workspaces (id) on delete set null,
  actor_id text references auth_users (id) on delete set null,
  action text not null,
  target text,
  data jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index app_audit_log_workspace_idx on app_audit_log (workspace_id, created_at desc);

create table app_billing_details (
  workspace_id text primary key references app_workspaces (id) on delete cascade,
  legal_name text not null,
  gstin text,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  pin text not null,
  state_code text not null,
  email text not null,
  updated_by text references auth_users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table app_billing_orders (
  id text primary key,
  workspace_id text references app_workspaces (id) on delete set null,
  kind text not null,
  payload jsonb not null default '{}',
  lines jsonb not null,
  buyer jsonb not null,
  seller jsonb not null,
  sac text not null,
  gst_percent numeric(5, 2) not null,
  taxable_paise bigint not null check (taxable_paise > 0),
  cgst_paise bigint not null check (cgst_paise >= 0),
  sgst_paise bigint not null check (sgst_paise >= 0),
  igst_paise bigint not null check (igst_paise >= 0),
  total_paise bigint not null check (total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise),
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'expired')),
  mode text not null check (mode in ('test', 'live')),
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  created_by text references auth_users (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index app_billing_orders_workspace_idx on app_billing_orders (workspace_id, created_at desc);

create table app_invoice_counters (
  prefix text primary key,
  last_sequence integer not null check (last_sequence > 0)
);

create table app_invoices (
  id text primary key,
  number text not null unique,
  order_id text not null unique references app_billing_orders (id),
  workspace_id text references app_workspaces (id) on delete set null,
  issued_at timestamptz not null,
  file_key text,
  emailed_at timestamptz,
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text
);
create index app_invoices_workspace_idx on app_invoices (workspace_id, issued_at desc);
create index app_invoices_unfinished_idx on app_invoices (issued_at) where emailed_at is null;

create table app_razorpay_events (
  event_id text primary key,
  event text not null,
  received_at timestamptz not null default now()
);

create table app_esign_credits (
  workspace_id text primary key references app_workspaces (id) on delete cascade,
  available integer not null default 0 check (available >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now()
);

create table app_esign_credit_ledger (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  kind text not null check (kind in ('grant', 'reserve', 'consume', 'release')),
  credits integer not null check (credits > 0),
  ref text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, ref)
);
create index app_esign_credit_ledger_workspace_idx
  on app_esign_credit_ledger (workspace_id, created_at desc);
`,
  },
  {
    name: '0014_plan_v2',
    sql: `
alter table app_workspaces add column if not exists extra_seats integer not null default 0
  check (extra_seats >= 0);
`,
  },
  {
    name: '0016_esign_settings',
    sql: `
create table app_esign_settings (
  workspace_id text primary key references app_workspaces(id) on delete cascade,
  mode text not null default 'platform' check (mode in ('platform', 'own')),
  own_api_key text,
  own_private_salt text,
  own_workflow_id text,
  own_environment text check (own_environment in ('sandbox', 'production')),
  own_key_hint text,
  own_saved_at timestamptz,
  own_tested_at timestamptz,
  own_test_ok boolean,
  version integer not null default 0,
  updated_by text references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_esign_usage (
  ref text primary key,
  workspace_id text not null references app_workspaces(id) on delete cascade,
  envelope_id text not null,
  recipient_id text not null,
  mode text not null check (mode in ('platform', 'own')),
  billed boolean not null,
  outcome text check (outcome in ('signed', 'declined', 'expired', 'failed')),
  unbilled boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index app_esign_usage_workspace on app_esign_usage (workspace_id, started_at desc);
`,
  },
  {
    name: '0015_subscriptions',
    sql: `
create table app_subscriptions (
  workspace_id text primary key references app_workspaces (id) on delete cascade,
  term text not null check (term in ('month', 'year')),
  seats integer not null default 0 check (seats >= 0),
  renewal_seats integer not null default 0 check (renewal_seats >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null check (status in ('active', 'grace', 'ended')),
  cancel_at_period_end boolean not null default false,
  grace_ends_at timestamptz,
  last_reminder text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index app_subscriptions_due_idx on app_subscriptions (period_end) where status <> 'ended';

create table app_install_bookings (
  id text primary key,
  order_id text not null unique references app_billing_orders (id),
  name text not null,
  email text not null,
  phone text not null,
  company text not null,
  provider text not null,
  server_details text not null,
  preferred_time text not null,
  paid_at timestamptz,
  notified_at timestamptz,
  notify_attempts integer not null default 0,
  notify_claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index app_install_bookings_unnotified_idx on app_install_bookings (paid_at)
  where notified_at is null;
`,
  },
  {
    name: '0017_invoice_payment_method',
    sql: `
alter table app_billing_orders add column payment_method text;
`,
  },
];
