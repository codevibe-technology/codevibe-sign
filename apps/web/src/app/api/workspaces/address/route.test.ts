import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  role: 'admin' as Role | null,
  checks: [] as { slug: string; workspace: unknown }[],
  taken: new Set<string>(['codevibe']),
}));

vi.mock('@/server/auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/db', () => ({ db: () => ({}) }));
vi.mock('@/server/env', () => ({ env: () => ({ TRUST_PROXY: true }) }));
vi.mock('@/server/workspaces', () => ({
  findMembership: async (_sql: unknown, _user: string, by: { id: string }) =>
    state.role && by.id === 'ws_1'
      ? { workspace: { id: 'ws_1', slug: 'acme', name: 'Acme' }, role: state.role }
      : null,
}));
vi.mock('@/server/workspace-address', () => ({
  checkAddress: async (_sql: unknown, slug: string, workspace: unknown) => {
    state.checks.push({ slug, workspace });
    return state.taken.has(slug)
      ? {
          slug,
          status: 'taken',
          message: 'This address is taken. Try codevibe-2.',
          suggestions: ['codevibe-2'],
        }
      : { slug, status: 'available', message: 'Available', suggestions: [] };
  },
}));

const { GET } = await import('./route');

let address = 0;
let person = 0;
function get(query: string, ip = `198.51.100.${++address}`) {
  return GET(
    new Request(`http://localhost/api/workspaces/address?${query}`, {
      headers: { 'x-forwarded-for': ip },
    }),
  );
}

beforeEach(() => {
  state.user = { id: `u${++person}` };
  state.role = 'admin';
  state.checks = [];
});

describe('GET /api/workspaces/address', () => {
  it('needs a signed-in person', async () => {
    state.user = null;
    const response = await get('slug=codevibe');
    expect(response.status).toBe(401);
    expect(state.checks).toEqual([]);
  });

  it('answers available or taken with suggestions, never cached', async () => {
    const free = await get('slug=acme-hr');
    expect(free.status).toBe(200);
    expect(free.headers.get('cache-control')).toBe('private, no-store');
    expect(await free.json()).toMatchObject({ ok: true, data: { status: 'available' } });
    const taken = await get('slug=codevibe');
    expect(await taken.json()).toMatchObject({
      data: { status: 'taken', suggestions: ['codevibe-2'] },
    });
  });

  it('checks for the workspace being renamed only when the person may manage it', async () => {
    await get('slug=acme-2&workspace=ws_1');
    expect(state.checks.at(-1)).toEqual({
      slug: 'acme-2',
      workspace: { id: 'ws_1', slug: 'acme', name: 'Acme' },
    });
    state.role = 'member';
    expect((await get('slug=acme-2&workspace=ws_1')).status).toBe(404);
    expect((await get('slug=acme-2&workspace=ws_other')).status).toBe(404);
  });

  it('limits each person', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 121; i++) last = await get(`slug=a${i}x`);
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await last?.json()).toMatchObject({ ok: false });
  });

  it('limits each client address across people', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 301; i++) {
      state.user = { id: `crowd-${i}` };
      last = await get(`slug=b${i}x`, '203.0.113.9');
    }
    expect(last?.status).toBe(429);
  });
});
