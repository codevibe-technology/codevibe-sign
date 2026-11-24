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
    name: '0013_accounts',
    sql: `
create table app_accounts (
  id text primary key,
  owner_user_id text unique references auth_users (id) on delete restrict,
  plan text not null default 'unlimited' check (plan in ('free', 'cloud', 'unlimited')),
  plan_source text not null default 'operator' check (plan_source in ('operator', 'billing')),
  extra_seats integer not null default 0 check (extra_seats >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_workspaces add column account_id text references app_accounts (id) on delete restrict;

create temporary table tmp_workspace_owner on commit drop as
select
  w.id as workspace_id,
  case w.plan when 'unlimited' then 2 when 'cloud' then 1 else 0 end as plan_rank,
  (
    select m.user_id from app_members m where m.workspace_id = w.id
    order by
      (m.role = 'owner' and m.user_id = w.created_by) desc,
      case m.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end,
      m.created_at, m.user_id
    limit 1
  ) as user_id
from app_workspaces w;

-- Whoever holds the account of a workspace manages its billing, which takes the owner role.
update app_members m set role = 'owner'
from tmp_workspace_owner t
where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.role <> 'owner';

insert into app_accounts (id, owner_user_id, plan)
select
  'acct_' || substr(md5(user_id || clock_timestamp()::text || random()::text), 1, 20),
  user_id,
  case max(plan_rank) when 2 then 'unlimited' when 1 then 'cloud' else 'free' end
from tmp_workspace_owner where user_id is not null group by user_id;

update app_workspaces w set account_id = a.id
from tmp_workspace_owner t join app_accounts a on a.owner_user_id = t.user_id
where t.workspace_id = w.id;

insert into app_accounts (id, owner_user_id, plan)
select 'acct_' || substr(md5('orphan' || w.id), 1, 20), null, w.plan
from app_workspaces w where w.account_id is null;

update app_workspaces w set account_id = 'acct_' || substr(md5('orphan' || w.id), 1, 20)
where w.account_id is null;

-- The per-workspace plan is no longer read. It is kept equal to the account's, so a build from
-- before accounts still finds a sensible plan if the install is rolled back. Such a build
-- does not fill account_id, so the column's not-null rule has to be dropped first; see
-- "Rolling back" in deploy/README.md.
update app_workspaces w set plan = a.plan
from app_accounts a where a.id = w.account_id and w.plan <> a.plan;

alter table app_workspaces alter column account_id set not null;
create index app_workspaces_account_idx on app_workspaces (account_id);

alter table app_plan_changes add column account_id text references app_accounts (id) on delete cascade;
alter table app_plan_changes alter column workspace_id drop not null;
update app_plan_changes c set account_id = w.account_id
from app_workspaces w where w.id = c.workspace_id;
create index app_plan_changes_account_idx on app_plan_changes (account_id, created_at desc);
`,
  },
  {
    name: '0014_billing',
    sql: `
create table app_audit_log (
  id text primary key,
  workspace_id text references app_workspaces (id) on delete set null,
  account_id text references app_accounts (id) on delete set null,
  actor_id text references auth_users (id) on delete set null,
  action text not null,
  target text,
  data jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index app_audit_log_workspace_idx on app_audit_log (workspace_id, created_at desc);
create index app_audit_log_account_idx on app_audit_log (account_id, created_at desc);

create table app_billing_details (
  account_id text primary key references app_accounts (id) on delete cascade,
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
  account_id text references app_accounts (id) on delete set null,
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
create index app_billing_orders_account_idx on app_billing_orders (account_id, created_at desc);

create table app_invoice_counters (
  prefix text primary key,
  last_sequence integer not null check (last_sequence > 0)
);

create table app_invoices (
  id text primary key,
  number text not null unique,
  order_id text not null unique references app_billing_orders (id),
  account_id text references app_accounts (id) on delete set null,
  issued_at timestamptz not null,
  file_key text,
  emailed_at timestamptz,
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text
);
create index app_invoices_account_idx on app_invoices (account_id, issued_at desc);
create index app_invoices_unfinished_idx on app_invoices (issued_at) where emailed_at is null;

create table app_razorpay_events (
  event_id text primary key,
  event text not null,
  received_at timestamptz not null default now()
);

create table app_esign_credits (
  account_id text primary key references app_accounts (id) on delete cascade,
  available integer not null default 0 check (available >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now()
);

create table app_esign_credit_ledger (
  id text primary key,
  account_id text not null references app_accounts (id) on delete cascade,
  kind text not null check (kind in ('grant', 'reserve', 'consume', 'release')),
  credits integer not null check (credits > 0),
  ref text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (account_id, kind, ref)
);
create index app_esign_credit_ledger_account_idx
  on app_esign_credit_ledger (account_id, created_at desc);
`,
  },
  {
    name: '0015_subscriptions',
    sql: `
create table app_subscriptions (
  account_id text primary key references app_accounts (id) on delete cascade,
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
    name: '0016_esign_settings',
    sql: `
create table app_esign_settings (
  account_id text primary key references app_accounts (id) on delete cascade,
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
  account_id text not null references app_accounts (id) on delete cascade,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  envelope_id text not null,
  recipient_id text not null,
  mode text not null check (mode in ('platform', 'own')),
  billed boolean not null,
  outcome text check (outcome in ('signed', 'declined', 'expired', 'failed')),
  unbilled boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index app_esign_usage_account on app_esign_usage (account_id, started_at desc);
create index app_esign_usage_workspace on app_esign_usage (workspace_id, started_at desc);
`,
  },
  {
    name: '0017_invoice_payment_method',
    sql: `
alter table app_billing_orders add column payment_method text;
`,
  },
  {
    name: '0018_billing_safeguards',
    sql: `
alter table app_billing_orders drop constraint app_billing_orders_status_check;
alter table app_billing_orders add constraint app_billing_orders_status_check
  check (status in ('created', 'paid', 'failed', 'expired', 'paid_unapplied', 'refunded'));
alter table app_billing_orders add column unapplied_reason text;
alter table app_billing_orders add column reversed_at timestamptz;

create table app_operator_notices (
  id text primary key,
  kind text not null,
  order_id text references app_billing_orders (id) on delete set null,
  account_id text references app_accounts (id) on delete set null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  claimed_at timestamptz
);
create index app_operator_notices_unsent_idx on app_operator_notices (created_at)
  where sent_at is null;

alter table app_esign_credit_ledger drop constraint app_esign_credit_ledger_kind_check;
alter table app_esign_credit_ledger add constraint app_esign_credit_ledger_kind_check
  check (kind in ('grant', 'reserve', 'consume', 'release', 'void'));
alter table app_esign_credit_ledger add column mode text check (mode in ('test', 'live'));
update app_esign_credit_ledger l set mode = o.mode
  from app_billing_orders o where l.kind = 'grant' and l.ref = o.id;

alter table app_subscriptions add column order_id text references app_billing_orders (id);
alter table app_subscriptions add column prior jsonb;
`,
  },
  {
    name: '0019_esign_owed',
    sql: `
alter table app_esign_usage add column owed_settled_at timestamptz;
alter table app_esign_usage add column sandbox boolean not null default false;
create index app_esign_usage_owed on app_esign_usage (account_id)
  where unbilled and owed_settled_at is null;
`,
  },
  {
    name: '0020_billing_admin_role',
    sql: `
alter table app_members drop constraint app_members_role_check;
alter table app_members add constraint app_members_role_check
  check (role in ('owner', 'admin', 'billing', 'member', 'viewer'));
alter table app_invitations drop constraint app_invitations_role_check;
alter table app_invitations add constraint app_invitations_role_check
  check (role in ('owner', 'admin', 'billing', 'member', 'viewer'));
`,
  },
  {
    name: '0021_workspace_transfers',
    sql: `
create table app_workspace_transfers (
  id text primary key,
  workspace_id text not null references app_workspaces (id) on delete cascade,
  from_account_id text references app_accounts (id) on delete set null,
  from_user_id text references auth_users (id) on delete set null,
  to_email text not null,
  to_user_id text references auth_users (id) on delete set null,
  to_account_id text references app_accounts (id) on delete set null,
  previous_owner_stays boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text references auth_users (id) on delete set null
);
create unique index app_workspace_transfers_pending_idx on app_workspace_transfers (workspace_id)
  where status = 'pending';
create index app_workspace_transfers_workspace_idx
  on app_workspace_transfers (workspace_id, created_at desc);
create index app_workspace_transfers_to_idx on app_workspace_transfers (lower(to_email))
  where status = 'pending';
`,
  },
  {
    name: '0022_brand_logo_size',
    sql: `
alter table app_brand_settings add column logo_width integer, add column logo_height integer;
`,
  },
  {
    name: '0023_user_tours',
    sql: `
create table app_user_tours (
  user_id text not null references auth_users (id) on delete cascade,
  tour text not null,
  status text not null check (status in ('started', 'done', 'skipped')),
  updated_at timestamptz not null default now(),
  primary key (user_id, tour)
);
-- People who were here before the tours already know their way around: theirs stay closed.
insert into app_user_tours (user_id, tour, status)
  select u.id, t.tour, 'skipped' from auth_users u cross join (values ('workspace'), ('send')) as t (tour);
`,
  },
  {
    name: '0024_esign_v4_workflow',
    sql: `
-- The ids of a Leegality v4 workflow read from its API payload, for the Aadhaar seal position.
alter table app_esign_settings add column own_v4_workflow jsonb;
`,
  },
];
