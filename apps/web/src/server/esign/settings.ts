import 'server-only';
import type { LeegalityV4Workflow } from '@codevibe_technology/sign-aadhaar';
import type postgres from 'postgres';
import { AppError } from '../errors';
import { openSecret, sealSecret } from '../billing/secret-box';

type Sql = postgres.Sql | postgres.TransactionSql;

export type EsignMode = 'platform' | 'own';
export type EsignEnvironment = 'sandbox' | 'production';

/** What the app may show about an account's eSign set-up. Never holds a credential. */
export interface EsignSettings {
  mode: EsignMode;
  own: {
    configured: boolean;
    /** The last four characters of the saved API key, to tell accounts apart. */
    keyHint: string | null;
    environment: EsignEnvironment | null;
    savedAt: string | null;
    testedAt: string | null;
    testOk: boolean | null;
    /** A V4 workflow is saved; the Aadhaar seal position then goes through the v4 API. */
    v4Workflow: boolean;
  };
  /** Changes whenever the mode or the credentials change. */
  version: number;
}

export interface OwnCredentials {
  apiKey: string;
  privateSalt: string;
  workflowId: string;
  environment: EsignEnvironment;
  /** The v4 workflow that places the signature at the sender's Aadhaar seal position. */
  v4?: LeegalityV4Workflow;
}

interface Row {
  mode: EsignMode;
  own_api_key: string | null;
  own_private_salt: string | null;
  own_workflow_id: string | null;
  own_environment: EsignEnvironment | null;
  own_key_hint: string | null;
  own_saved_at: Date | null;
  own_tested_at: Date | null;
  own_test_ok: boolean | null;
  own_v4_workflow: LeegalityV4Workflow | null;
  version: number;
}

const DEFAULTS: EsignSettings = {
  mode: 'platform',
  own: {
    configured: false,
    keyHint: null,
    environment: null,
    savedAt: null,
    testedAt: null,
    testOk: null,
    v4Workflow: false,
  },
  version: 0,
};

const context = (accountId: string, what: 'apiKey' | 'privateSalt') =>
  `${accountId}:leegality.${what}`;

const hasCredentials = (row: Row) =>
  Boolean(row.own_api_key && row.own_private_salt && row.own_workflow_id && row.own_environment);

const toSettings = (row: Row): EsignSettings => ({
  mode: row.mode,
  own: {
    configured: hasCredentials(row),
    keyHint: row.own_key_hint,
    environment: row.own_environment,
    savedAt: row.own_saved_at?.toISOString() ?? null,
    testedAt: row.own_tested_at?.toISOString() ?? null,
    testOk: row.own_test_ok,
    v4Workflow: hasCredentials(row) && row.own_v4_workflow !== null,
  },
  version: row.version,
});

async function read(sql: Sql, accountId: string): Promise<Row | null> {
  const [row] = await sql<Row[]>`
    select mode, own_api_key, own_private_salt, own_workflow_id, own_environment, own_key_hint,
           own_saved_at, own_tested_at, own_test_ok, own_v4_workflow, version
    from app_esign_settings where account_id = ${accountId}`;
  return row ?? null;
}

export async function getEsignSettings(sql: Sql, accountId: string): Promise<EsignSettings> {
  const row = await read(sql, accountId);
  return row ? toSettings(row) : DEFAULTS;
}

/**
 * The workspace's own provider credentials, opened for use on the server. Null when none are
 * saved or they can no longer be opened (the install's secret key changed).
 */
export async function ownCredentials(sql: Sql, accountId: string): Promise<OwnCredentials | null> {
  const row = await read(sql, accountId);
  if (!row || !hasCredentials(row)) return null;
  try {
    return {
      apiKey: openSecret(row.own_api_key!, context(accountId, 'apiKey')),
      privateSalt: openSecret(row.own_private_salt!, context(accountId, 'privateSalt')),
      workflowId: row.own_workflow_id!,
      environment: row.own_environment!,
      ...(row.own_v4_workflow ? { v4: row.own_v4_workflow } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * eSigns of the account that were started and have not ended yet. Every started eSign ends:
 * signed, declined, failed, or expired once the wait for it is over.
 */
export async function openEsigns(sql: Sql, accountId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from app_esign_usage
    where account_id = ${accountId} and outcome is null`;
  return row?.count ?? 0;
}

/**
 * A callback from the provider is checked with the account the eSign was started on, so the
 * account cannot change while a signer is at the provider.
 */
async function assertNoneOpen(sql: Sql, accountId: string): Promise<void> {
  if ((await openEsigns(sql, accountId)) > 0) {
    throw new AppError(
      'CONFLICT',
      'Someone is signing with Aadhaar eSign right now. Change this once they have finished, or after the request expires.',
    );
  }
}

/**
 * Locks the account's row for the rest of the transaction. Starting an eSign takes the same
 * lock, so a change to the mode or the credentials and a start never overlap: the start
 * sees the settings either before the change or after it.
 */
export async function lockEsignAccount(tx: Sql, accountId: string): Promise<void> {
  await tx`select 1 from app_accounts where id = ${accountId} for update`;
}

/** Runs a settings change under the account lock, in its own transaction when not in one. */
async function changing<T>(
  sql: Sql,
  accountId: string,
  change: (tx: Sql) => Promise<T>,
): Promise<T> {
  const run = async (tx: Sql) => {
    await lockEsignAccount(tx, accountId);
    return change(tx);
  };
  return 'begin' in sql ? ((await sql.begin((tx) => run(tx))) as T) : run(sql);
}

export async function setEsignMode(
  outer: Sql,
  input: { accountId: string; userId: string; mode: EsignMode },
): Promise<EsignSettings> {
  return changing(outer, input.accountId, async (sql) => {
    const current = await getEsignSettings(sql, input.accountId);
    if (current.mode === input.mode) return current;
    if (input.mode === 'own' && !current.own.configured) {
      throw new AppError('VALIDATION', 'Add your Leegality account details first.', 'credentials');
    }
    await assertNoneOpen(sql, input.accountId);
    await sql`
      insert into app_esign_settings (account_id, mode, version, updated_by)
      values (${input.accountId}, ${input.mode}, 1, ${input.userId})
      on conflict (account_id) do update
      set mode = excluded.mode, version = app_esign_settings.version + 1,
          updated_by = excluded.updated_by, updated_at = now()`;
    return getEsignSettings(sql, input.accountId);
  });
}

export async function saveOwnCredentials(
  outer: Sql,
  input: { accountId: string; userId: string; credentials: OwnCredentials },
): Promise<EsignSettings> {
  return changing(outer, input.accountId, async (sql) => {
    const { accountId, credentials } = input;
    const current = await getEsignSettings(sql, accountId);
    if (current.mode === 'own') await assertNoneOpen(sql, accountId);
    const apiKey = sealSecret(credentials.apiKey, context(accountId, 'apiKey'));
    const salt = sealSecret(credentials.privateSalt, context(accountId, 'privateSalt'));
    const hint = credentials.apiKey.slice(-4);
    const v4 = credentials.v4 ? sql.json(credentials.v4 as unknown as postgres.JSONValue) : null;
    await sql`
      insert into app_esign_settings (
        account_id, own_api_key, own_private_salt, own_workflow_id, own_environment,
        own_v4_workflow, own_key_hint, own_saved_at, version, updated_by
      ) values (
        ${accountId}, ${apiKey}, ${salt}, ${credentials.workflowId}, ${credentials.environment},
        ${v4}, ${hint}, now(), 1, ${input.userId}
      )
      on conflict (account_id) do update
      set own_api_key = excluded.own_api_key, own_private_salt = excluded.own_private_salt,
          own_workflow_id = excluded.own_workflow_id, own_environment = excluded.own_environment,
          own_v4_workflow = excluded.own_v4_workflow,
          own_key_hint = excluded.own_key_hint, own_saved_at = now(),
          own_tested_at = null, own_test_ok = null,
          version = app_esign_settings.version + 1,
          updated_by = excluded.updated_by, updated_at = now()`;
    return getEsignSettings(sql, accountId);
  });
}

/** Forgets the account's own account and goes back to the install's. */
export async function removeOwnCredentials(
  outer: Sql,
  input: { accountId: string; userId: string },
): Promise<EsignSettings> {
  return changing(outer, input.accountId, async (sql) => {
    const current = await getEsignSettings(sql, input.accountId);
    if (current.mode === 'own') await assertNoneOpen(sql, input.accountId);
    await sql`
      update app_esign_settings
      set mode = 'platform', own_api_key = null, own_private_salt = null, own_workflow_id = null,
          own_v4_workflow = null, own_environment = null, own_key_hint = null, own_saved_at = null, own_tested_at = null,
          own_test_ok = null, version = version + 1, updated_by = ${input.userId},
          updated_at = now()
      where account_id = ${input.accountId}`;
    return getEsignSettings(sql, input.accountId);
  });
}

export async function recordConnectionTest(
  sql: Sql,
  accountId: string,
  ok: boolean,
): Promise<void> {
  await sql`
    update app_esign_settings set own_tested_at = now(), own_test_ok = ${ok}
    where account_id = ${accountId}`;
}
