export interface Migration {
  name: string;
  sql: string;
}

/** Applied in order by `migrate()`. Exported so you can run them with your own migration tool. */
export const migrations: readonly Migration[] = [
  {
    name: '0001_init',
    sql: `
create table sign_envelopes (
  id text primary key,
  status text not null,
  data jsonb not null,
  version integer not null,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sign_envelopes_next_check_idx on sign_envelopes (next_check_at)
  where next_check_at is not null;

create table sign_audit_events (
  envelope_id text not null references sign_envelopes (id) on delete cascade,
  seq integer not null,
  data jsonb not null,
  primary key (envelope_id, seq)
);

create table sign_tokens (
  hash text primary key,
  envelope_id text not null references sign_envelopes (id) on delete cascade,
  recipient_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index sign_tokens_recipient_idx on sign_tokens (envelope_id, recipient_id);

create table sign_otp_challenges (
  envelope_id text not null references sign_envelopes (id) on delete cascade,
  recipient_id text not null,
  state jsonb not null,
  expires_at timestamptz not null,
  primary key (envelope_id, recipient_id)
);

create table sign_idempotency (
  scope text not null,
  key text not null,
  fingerprint text not null,
  status integer,
  body jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

create table sign_jobs (
  id text primary key,
  kind text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  run_at timestamptz not null,
  state text not null default 'pending',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sign_jobs_due_idx on sign_jobs (run_at) where state = 'pending';
`,
  },
  {
    name: '0002_otp_issuance',
    sql: `
alter table sign_otp_challenges
  add column issued integer not null default 1,
  add column version integer not null default 1;
`,
  },
  {
    name: '0003_workspaces',
    sql: `
alter table sign_envelopes
  add column workspace_id text not null default 'default';
create index sign_envelopes_workspace_idx
  on sign_envelopes (workspace_id, created_at desc, id desc);
`,
  },
  {
    name: '0004_templates_and_sealed_lookup',
    sql: `
create table sign_templates (
  id text primary key,
  workspace_id text not null,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index sign_templates_workspace_idx
  on sign_templates (workspace_id, created_at desc, id desc);

create index sign_audit_events_sealed_sha256_idx
  on sign_audit_events ((data->'data'->>'sha256'))
  where data->>'action' = 'document.sealed';
`,
  },
  {
    name: '0005_esign_sessions',
    sql: `
create table sign_esign_sessions (
  id text primary key,
  workspace_id text not null,
  envelope_id text not null references sign_envelopes (id) on delete cascade,
  recipient_id text not null,
  document_id text not null,
  provider text not null,
  provider_ref text,
  sign_url text,
  status text not null,
  data jsonb not null,
  unsettled text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null
);
create unique index sign_esign_sessions_ref_idx
  on sign_esign_sessions (provider, provider_ref) where provider_ref is not null;
create unique index sign_esign_sessions_open_idx
  on sign_esign_sessions (envelope_id, recipient_id) where status in ('starting', 'pending');
create index sign_esign_sessions_recipient_idx
  on sign_esign_sessions (envelope_id, recipient_id, created_at desc);
create index sign_esign_sessions_due_idx
  on sign_esign_sessions (expires_at) where status in ('starting', 'pending');
create index sign_esign_sessions_unsettled_idx
  on sign_esign_sessions (updated_at) where unsettled is not null;
`,
  },
];
