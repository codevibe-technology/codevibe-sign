import { memoryRateLimiter } from '@codevibe_technology/sign-server';
import { can } from '@/lib/roles';
import { getSessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { checkAddress } from '@/server/workspace-address';
import { findMembership } from '@/server/workspaces';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60 * 1000;
/** Checks one person may make in ten minutes: a few hundred keystrokes, debounced. */
const CHECKS_PER_PERSON = 120;
/** Checks from one address in ten minutes, for an office of people creating workspaces. */
const CHECKS_PER_CLIENT = 300;

const holder = globalThis as unknown as {
  __cvsAddressLimiter?: ReturnType<typeof memoryRateLimiter>;
};
const limiter = () => (holder.__cvsAddressLimiter ??= memoryRateLimiter({ maxKeys: 20_000 }));

/** The address added by the proxy in front of the app, when the app is told to trust it. */
function clientKey(request: Request): string | null {
  if (!env().TRUST_PROXY) return null;
  const entries = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? null;
}

const answer = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store', ...extra } });

/**
 * Whether a workspace address is free, for the address box while someone types. Signed-in
 * people only (a workspace is created after signing in), limited per person and per client
 * address. `workspace` names the workspace being renamed, so its own address and its old ones
 * count as its own.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return answer(401, { ok: false, error: 'Your session has ended. Sign in again.' });
  const now = new Date();
  const ip = clientKey(request);
  const checks = [limiter().hit(`user:${user.id}`, CHECKS_PER_PERSON, WINDOW_MS, now)];
  if (ip) checks.push(limiter().hit(`ip:${ip}`, CHECKS_PER_CLIENT, WINDOW_MS, now));
  const limits = await Promise.all(checks);
  const blocked = limits.find((limit) => !limit.allowed);
  if (blocked) {
    return answer(
      429,
      { ok: false, error: 'Too many checks in a short time. Wait a minute and try again.' },
      { 'retry-after': String(Math.ceil(blocked.retryAfterMs / 1000)) },
    );
  }
  const params = new URL(request.url).searchParams;
  const slug = (params.get('slug') ?? '').slice(0, 200);
  const workspaceId = params.get('workspace');
  const sql = db();
  let workspace: { id: string; slug: string } | null = null;
  if (workspaceId) {
    const membership = await findMembership(sql, user.id, { id: workspaceId.slice(0, 64) });
    if (!membership || !can(membership.role, 'workspace.manage')) {
      return answer(404, { ok: false, error: 'Workspace not found' });
    }
    workspace = membership.workspace;
  }
  return answer(200, { ok: true, data: await checkAddress(sql, slug, workspace) });
}
