import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: null as Role | null,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
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

const { requireWorkspace } = await import('./guards');

beforeEach(() => {
  state.user = { id: 'u1' };
  state.role = 'member';
});

describe('requireWorkspace', () => {
  it('sends visitors to sign-in and back', async () => {
    state.user = null;
    await expect(requireWorkspace('acme')).rejects.toThrow('REDIRECT /sign-in?next=%2Fw%2Facme');
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
});
