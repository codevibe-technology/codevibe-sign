import 'server-only';
import type postgres from 'postgres';
import { AppError } from '../errors';
import { openSecret, sealSecret } from '../billing/secret-box';

type Sql = postgres.Sql | postgres.TransactionSql;

export type EsignMode = 'platform' | 'own';
export type EsignEnvironment = 'sandbox' | 'production';

/** What the app may show about a workspace's eSign set-up. Never holds a credential. */
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
  };
  /** Changes whenever the mode or the credentials change. */
  version: number;
}

export interface OwnCredentials {
  apiKey: string;
  privateSalt: string;
  workflowId: string;
  environment: EsignEnvironment;
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
  },
  version: 0,
};

const context = (workspaceId: string, what: 'apiKey' | 'privateSalt') =>
  `${workspaceId}:leegality.${what}`;

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
  },
  version: row.version,
});

async function read(sql: Sql, workspaceId: string): Promise<Row | null> {
  const [row] = await sql<Row[]>`
    select mode, own_api_key, own_private_salt, own_workflow_id, own_environment, own_key_hint,
           own_saved_at, own_tested_at, own_test_ok, version
    from app_esign_settings where workspace_id = ${workspaceId}`;
  return row ?? null;
}

export async function getEsignSettings(sql: Sql, workspaceId: string): Promise<EsignSettings> {
  const row = await read(sql, workspaceId);
  return row ? toSettings(row) : DEFAULTS;
}

/**
 * The workspace's own provider credentials, opened for use on the server. Null when none are
 * saved or they can no longer be opened (the install's secret key changed).
 */
export async function ownCredentials(
  sql: Sql,
  workspaceId: string,
): Promise<OwnCredentials | null> {
  const row = await read(sql, workspaceId);
  if (!row || !hasCredentials(row)) return null;
  try {
    return {
      apiKey: openSecret(row.own_api_key!, context(workspaceId, 'apiKey')),
      privateSalt: openSecret(row.own_private_salt!, context(workspaceId, 'privateSalt')),
      workflowId: row.own_workflow_id!,
      environment: row.own_environment!,
    };
  } catch {
    return null;
  }
}

/** eSigns of the workspace that were started and have not ended yet. */
export async function openEsigns(sql: Sql, workspaceId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from app_esign_usage
    where workspace_id = ${workspaceId} and outcome is null
      and started_at > now() - interval '25 hours'`;
  return row?.count ?? 0;
}

/**
 * A callback from the provider is checked with the account the eSign was started on, so the
 * account cannot change while a signer is at the provider.
 */
async function assertNoneOpen(sql: Sql, workspaceId: string): Promise<void> {
  if ((await openEsigns(sql, workspaceId)) > 0) {
    throw new AppError(
      'CONFLICT',
      'Someone is signing with Aadhaar eSign right now. Change this once they have finished, or after the request expires.',
    );
  }
}

export async function setEsignMode(
  sql: Sql,
  input: { workspaceId: string; userId: string; mode: EsignMode },
): Promise<EsignSettings> {
  const current = await getEsignSettings(sql, input.workspaceId);
  if (current.mode === input.mode) return current;
  if (input.mode === 'own' && !current.own.configured) {
    throw new AppError('VALIDATION', 'Add your Leegality account details first.', 'credentials');
  }
  await assertNoneOpen(sql, input.workspaceId);
  await sql`
    insert into app_esign_settings (workspace_id, mode, version, updated_by)
    values (${input.workspaceId}, ${input.mode}, 1, ${input.userId})
    on conflict (workspace_id) do update
    set mode = excluded.mode, version = app_esign_settings.version + 1,
        updated_by = excluded.updated_by, updated_at = now()`;
  return getEsignSettings(sql, input.workspaceId);
}

export async function saveOwnCredentials(
  sql: Sql,
  input: { workspaceId: string; userId: string; credentials: OwnCredentials },
): Promise<EsignSettings> {
  const { workspaceId, credentials } = input;
  const current = await getEsignSettings(sql, workspaceId);
  if (current.mode === 'own') await assertNoneOpen(sql, workspaceId);
  const apiKey = sealSecret(credentials.apiKey, context(workspaceId, 'apiKey'));
  const salt = sealSecret(credentials.privateSalt, context(workspaceId, 'privateSalt'));
  const hint = credentials.apiKey.slice(-4);
  await sql`
    insert into app_esign_settings (
      workspace_id, own_api_key, own_private_salt, own_workflow_id, own_environment,
      own_key_hint, own_saved_at, version, updated_by
    ) values (
      ${workspaceId}, ${apiKey}, ${salt}, ${credentials.workflowId}, ${credentials.environment},
      ${hint}, now(), 1, ${input.userId}
    )
    on conflict (workspace_id) do update
    set own_api_key = excluded.own_api_key, own_private_salt = excluded.own_private_salt,
        own_workflow_id = excluded.own_workflow_id, own_environment = excluded.own_environment,
        own_key_hint = excluded.own_key_hint, own_saved_at = now(),
        own_tested_at = null, own_test_ok = null,
        version = app_esign_settings.version + 1,
        updated_by = excluded.updated_by, updated_at = now()`;
  return getEsignSettings(sql, workspaceId);
}

/** Forgets the workspace's own account and goes back to the install's. */
export async function removeOwnCredentials(
  sql: Sql,
  input: { workspaceId: string; userId: string },
): Promise<EsignSettings> {
  const current = await getEsignSettings(sql, input.workspaceId);
  if (current.mode === 'own') await assertNoneOpen(sql, input.workspaceId);
  await sql`
    update app_esign_settings
    set mode = 'platform', own_api_key = null, own_private_salt = null, own_workflow_id = null,
        own_environment = null, own_key_hint = null, own_saved_at = null, own_tested_at = null,
        own_test_ok = null, version = version + 1, updated_by = ${input.userId},
        updated_at = now()
    where workspace_id = ${input.workspaceId}`;
  return getEsignSettings(sql, input.workspaceId);
}

export async function recordConnectionTest(
  sql: Sql,
  workspaceId: string,
  ok: boolean,
): Promise<void> {
  await sql`
    update app_esign_settings set own_tested_at = now(), own_test_ok = ${ok}
    where workspace_id = ${workspaceId}`;
}
