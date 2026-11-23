import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: null as Role | null,
  moved: {} as Record<string, string>,
  path: null as string | null,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  permanentRedirect: (to: string) => {
    throw new Error(`MOVED ${to}`);
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.path ? { 'x-cvs-path': state.path } : {}),
}));
vi.mock('./auth', () => ({
  auth: () => ({
    api: {
      getSession: async () =>
        state.user ? { user: { ...state.user, name: 'A', email: 'a@x.co', image: null } } : null,
    },
  }),
}));
vi.mock('../db', () => ({ db: () => ({}) }));
vi.mock('../workspaces', () => ({
  findMembership: async (_sql: unknown, _user: string, by: { slug: string }) =>
    state.role && by.slug === 'acme'
      ? { workspace: { id: 'ws_1', slug: 'acme', name: 'Acme' }, role: state.role }
      : null,
}));
vi.mock('../workspace-address', async (original) => ({
  ...(await original<typeof import('../workspace-address')>()),
  movedAddress: async (_sql: unknown, _user: string, slug: string) => state.moved[slug] ?? null,
}));

const { requireWorkspace, workspaceNotFound } = await import('./guards');

beforeEach(() => {
  state.user = { id: 'u1' };
  state.role = 'member';
  state.moved = {};
  state.path = null;
});

describe('requireWorkspace', () => {
  it('sends visitors to sign-in and back', async () => {
    state.user = null;
    await expect(requireWorkspace('acme')).rejects.toThrow(
      'REDIRECT /sign-in?next=%2Fdashboard%2Facme',
    );
  });

  it('answers not found for people outside the workspace', async () => {
    await expect(requireWorkspace('other')).rejects.toThrow('NOT_FOUND');
    state.role = null;
    await expect(requireWorkspace('acme')).rejects.toThrow('NOT_FOUND');
  });

  it('answers not found when the role lacks the permission', async () => {
    await expect(requireWorkspace('acme', 'brand.manage')).rejects.toThrow('NOT_FOUND');
    state.role = 'admin';
    await expect(requireWorkspace('acme', 'brand.manage')).resolves.toMatchObject({
      role: 'admin',
    });
  });

  it('returns the member, workspace and role', async () => {
    expect(await requireWorkspace('acme')).toMatchObject({
      user: { id: 'u1' },
      workspace: { slug: 'acme' },
      role: 'member',
    });
  });

  it('sends a member from an old address to the same page at the new one', async () => {
    state.moved = { 'acme-old': 'acme' };
    state.path = '/dashboard/acme-old/envelopes/env_1?tab=activity';
    await expect(requireWorkspace('acme-old')).rejects.toThrow(
      'MOVED /dashboard/acme/envelopes/env_1?tab=activity',
    );
  });

  it('falls back to the workspace home when the path does not match', async () => {
    state.moved = { 'acme-old': 'acme' };
    state.path = '/elsewhere';
    await expect(requireWorkspace('acme-old')).rejects.toThrow('MOVED /dashboard/acme');
    state.path = null;
    await expect(requireWorkspace('acme-old')).rejects.toThrow('MOVED /dashboard/acme');
  });
});

describe('workspaceNotFound', () => {
  const request = (path: string) => new Request(`http://localhost${path}`);

  it('redirects a member from an old address with 308', async () => {
    state.moved = { 'acme-old': 'acme' };
    const response = await workspaceNotFound(
      request('/dashboard/acme-old/envelopes/env_1/documents/d1?version=sealed'),
      'acme-old',
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      '/dashboard/acme/envelopes/env_1/documents/d1?version=sealed',
    );
  });

  it('answers 404 to people signed out or outside the workspace', async () => {
    expect((await workspaceNotFound(request('/dashboard/x/y'), 'x')).status).toBe(404);
    state.user = null;
    state.moved = { x: 'acme' };
    expect((await workspaceNotFound(request('/dashboard/x/y'), 'x')).status).toBe(404);
  });
});
