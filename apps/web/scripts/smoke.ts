import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import postgres from 'postgres';
import { migrateAll } from '../src/server/migrate';

/**
 * Boots the built app (`pnpm --filter web build` first) against DATABASE_URL and walks the
 * main paths over real HTTP: health, sign-in by magic link, the guards, the template and
 * webhook pages, the API with a workspace key, and a signing link through to the branded
 * signing page. Exits non-zero on the
 * first failure.
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
  const guarded = await get('/dashboard/anything');
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
  const slug = `smoke-${Date.now()}`;
  await sql`insert into app_workspaces (id, slug, name) values (${workspaceId}, ${slug}, 'Smoke')`;
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

  const page = async (path: string, text: string) => {
    const res = await get(path, { headers: { cookie } });
    return res.status === 200 && (await res.text()).includes(text);
  };
  check(
    await page(`/dashboard/${slug}/templates`, 'No templates yet'),
    'the templates page renders',
  );
  check(
    await page(`/dashboard/${slug}/templates/new`, 'New template'),
    'the template editor renders',
  );
  const templateId = `tpl_${randomBytes(10).toString('hex')}`;
  const definition = {
    title: '',
    message: '',
    routing: 'sequential',
    expiresInDays: 14,
    remindEveryDays: 2,
    roles: [{ id: 'r1', name: 'Employee', type: 'signer', auth: 'email_link' }],
    documents: [
      { id: 'd1', name: 'offer.pdf', size: 1, sha256: '', pages: [{ width: 595, height: 842 }] },
    ],
    fields: [],
  };
  await sql`insert into app_templates (id, workspace_id, name, definition)
    values (${templateId}, ${workspaceId}, 'Smoke template', ${sql.json(definition)})`;
  check(
    await page(`/dashboard/${slug}/templates/${templateId}/send`, 'Send: Smoke template'),
    'sending from a template renders',
  );
  check(
    await page(`/dashboard/${slug}/templates/${templateId}/bulk`, 'Sample CSV'),
    'bulk send from a template renders',
  );
  check(
    await page(`/dashboard/${slug}/settings/webhooks`, 'No endpoints yet'),
    'the webhooks settings render',
  );

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595.28, 841.89]).drawText('Offer letter', { x: 72, y: 760, font });
  const created = await get('/api/v1/envelopes', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Smoke offer',
      send: true,
      documents: [
        { key: 'd', name: 'offer.pdf', content: Buffer.from(await pdf.save()).toString('base64') },
      ],
      recipients: [{ key: 'r', name: 'Ravi', email: `ravi-${Date.now()}@example.com` }],
      fields: [
        { recipient: 'r', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
      ],
    }),
  });
  check(created.status === 201, 'a workspace key sends an envelope');
  await new Promise((r) => setTimeout(r, 500));
  const token = /\/api\/sign\/([\w-]{43})/.exec(output)?.[1];
  check(token, 'the invitation with its signing link is printed to the console');
  const opened = await get(`/api/sign/${token}`);
  const linkCookie = opened.headers.get('set-cookie')?.split(';')[0] ?? '';
  check(
    opened.status === 303 && opened.headers.get('location') === `${base}/sign`,
    'the signing link redirects to /sign without the token',
  );
  const signingPage = await get('/sign');
  check(signingPage.status === 200, 'the signing page renders');
  const view = await get('/api/v1/sign/link', { headers: { cookie: linkCookie } });
  const signer = (await view.json()) as { workspaceId: string; recipient: { name: string } };
  check(signer.workspaceId === workspaceId, 'the page reads the envelope through the cookie');
  const header = await get(`/brand/${workspaceId}/signing`);
  check(
    header.status === 200 && ((await header.json()) as { name: string }).name === 'Smoke',
    'the signing page gets the workspace brand',
  );
  const ended = await get(`/sign?state=expired&w=${workspaceId}`);
  const endedHtml = await ended.text();
  check(
    endedHtml.includes('This link has expired') && endedHtml.includes('Ask Smoke'),
    'a dead link explains itself in the sender brand',
  );
  console.log('Smoke test passed.');
} finally {
  app.kill('SIGTERM');
  await sql.end();
}
