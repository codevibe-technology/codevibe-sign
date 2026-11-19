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
];
