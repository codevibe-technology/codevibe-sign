import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { migrateAll } from '../src/server/migrate';

/**
 * Boots the built app (`pnpm --filter web build` first) against DATABASE_URL and walks the
 * main paths over real HTTP: health, sign-in by magic link, the guards, and the API with a
 * workspace key. Exits non-zero on the first failure.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to a throwaway PostgreSQL database.');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3417);
const base = `http://localhost:${port}`;

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(`Failed: ${message}`);
  console.log(`  ok  ${message}`);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
await migrateAll(sql);

let output = '';
const app = spawn('node_modules/.bin/next', ['start', '-p', String(port)], {
  env: {
    ...process.env,
    APP_URL: base,
    AUTH_SECRET: process.env.AUTH_SECRET ?? randomBytes(32).toString('hex'),
    MAIL_TRANSPORT: 'console',
    SIGN_TICK_SECONDS: '0',
    SEAL_P12_PATH: process.env.SEAL_P12_PATH ?? 'data/dev-seal.p12',
    SEAL_PASSPHRASE: process.env.SEAL_PASSPHRASE ?? 'dev',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
app.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

const get = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { redirect: 'manual', ...init });

try {
  for (let i = 0; ; i++) {
    const ready = await get('/api/health').catch(() => null);
    if (ready?.ok) break;
    if (i > 60) throw new Error(`The app did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  check(true, 'app answers /api/health');

  const signIn = await get('/sign-in');
  check(
    signIn.status === 200 && (await signIn.text()).includes('Email me a sign-in link'),
    'sign-in page renders',
  );
  const guarded = await get('/w/anything');
  check(
    [307, 308].includes(guarded.status) && guarded.headers.get('location')?.includes('/sign-in'),
    'workspace pages need a session',
  );
  const anonymousApi = await get('/api/v1/envelopes');
  check(anonymousApi.status === 401, 'API refuses calls without a key');

  const email = `smoke-${Date.now()}@example.com`;
  const sent = await get('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email, callbackURL: '/' }),
  });
  check(sent.ok, 'magic link requested');
  await new Promise((r) => setTimeout(r, 300));
  const link = new RegExp(`${base}/api/auth/magic-link/verify\\S+`).exec(output)?.[0];
  check(link, 'magic link printed to the console in development');
  const verified = await get(link!.replace(base, ''));
  const cookie = verified.headers.get('set-cookie')?.split(';')[0] ?? '';
  check(cookie.startsWith('cvs.session_token='), 'magic link signs the person in');
  const home = await get('/', { headers: { cookie } });
  check(
    home.headers.get('location')?.endsWith('/onboarding'),
    'a new person is sent to onboarding',
  );
  const onboarding = await get('/onboarding', { headers: { cookie } });
  check(
    onboarding.status === 200 && (await onboarding.text()).includes('Create your workspace'),
    'onboarding renders',
  );

  const [user] = await sql<{ id: string }[]>`select id from auth_users where email = ${email}`;
  const workspaceId = `ws_${randomBytes(10).toString('hex')}`;
  await sql`insert into app_workspaces (id, slug, name) values (${workspaceId}, ${`smoke-${Date.now()}`}, 'Smoke')`;
  await sql`insert into app_members (workspace_id, user_id, role) values (${workspaceId}, ${user!.id}, 'owner')`;
  const key = `cvs_${randomBytes(32).toString('base64url')}`;
  await sql`insert into app_api_keys (id, workspace_id, name, key_hash, prefix)
    values (${`key_${randomBytes(10).toString('hex')}`}, ${workspaceId}, 'smoke',
      ${createHash('sha256').update(key).digest('hex')}, ${key.slice(0, 10)})`;
  const list = await get('/api/v1/envelopes', { headers: { authorization: `Bearer ${key}` } });
  check(
    list.status === 200 && (await list.json()).envelopes.length === 0,
    'a workspace key lists its envelopes',
  );
  const viaSession = await get('/api/v1/envelopes', {
    headers: { cookie, 'x-workspace': workspaceId },
  });
  check(viaSession.status === 200, 'a signed-in member reaches the API for their workspace');
  const otherWorkspace = await get('/api/v1/envelopes', {
    headers: { cookie, 'x-workspace': 'ws_other' },
  });
  check(otherWorkspace.status === 401, 'but not for a workspace they are not in');
  console.log('Smoke test passed.');
} finally {
  app.kill('SIGTERM');
  await sql.end();
}
