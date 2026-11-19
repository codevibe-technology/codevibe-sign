import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; image: null } | null,
  role: null as Role | null,
  singleWorkspace: false,
  workspaceCount: 0,
  calls: [] as string[],
}));

const WORKSPACE = { id: 'ws_1', slug: 'acme', name: 'Acme' };

vi.mock('../auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('../db', () => ({ db: () => ({}) }));
vi.mock('../env', () => ({
  env: () => ({ SINGLE_WORKSPACE: state.singleWorkspace, APP_URL: 'https://sign.example.com' }),
}));
vi.mock('../runtime', () => ({
  appRuntime: () => ({ files: {}, mailer: { send: async () => undefined } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: () => undefined }) }));

const record =
  <T>(name: string, value?: T) =>
  async () => {
    state.calls.push(name);
    return value;
  };

vi.mock('../workspaces', () => ({
  findMembership: async (_sql: unknown, _userId: string, by: { id: string }) =>
    state.role && by.id === WORKSPACE.id ? { workspace: WORKSPACE, role: state.role } : null,
  countWorkspaces: async () => state.workspaceCount,
  createWorkspace: record('createWorkspace', WORKSPACE),
  renameWorkspace: record('renameWorkspace', 'Renamed'),
}));
vi.mock('../brand', () => ({
  updateBrand: record('updateBrand'),
  setLogo: record('setLogo'),
  removeLogo: record('removeLogo'),
}));
vi.mock('../members', () => ({
  changeRole: record('changeRole'),
  removeMember: record('removeMember'),
}));
vi.mock('../invitations', () => ({
  createInvitation: record('createInvitation', {
    invitation: { email: 'new@example.com', role: 'member' },
    token: 't',
  }),
  revokeInvitation: record('revokeInvitation'),
  acceptInvitation: record('acceptInvitation', { workspaceSlug: 'acme' }),
}));
vi.mock('../mail', () => ({ sendInvitation: record('sendInvitation') }));
vi.mock('../api-keys', () => ({
  createApiKey: record('createApiKey', { id: 'key_1', key: 'cvs_x', prefix: 'cvs_x' }),
  revokeApiKey: record('revokeApiKey'),
}));
vi.mock('../preferences', () => ({
  updatePreferences: record('updatePreferences', { theme: 'dark', timezone: null, locale: 'en' }),
}));

const { createApiKeyAction, revokeApiKeyAction } = await import('./api-keys');
const { removeLogoAction, updateBrandAction, uploadLogoAction } = await import('./brand');
const { updatePreferencesAction } = await import('./personal');
const {
  acceptInvitationAction,
  changeRoleAction,
  inviteMemberAction,
  leaveWorkspaceAction,
  removeMemberAction,
  revokeInvitationAction,
} = await import('./team');
const { createWorkspaceAction, renameWorkspaceAction } = await import('./workspace');

const logo = () => {
  const form = new FormData();
  form.set('logo', new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
  return form;
};

/** Every workspace action, the lowest role allowed to use it, and a valid input. */
const workspaceActions: [string, Role, (input: unknown) => Promise<unknown>, () => unknown][] = [
  ['renameWorkspace', 'admin', renameWorkspaceAction, () => ({ name: 'New name' })],
  [
    'updateBrand',
    'admin',
    updateBrandAction,
    () => ({ brandColor: '#123456', font: 'inter', senderName: 'Acme HR' }),
  ],
  ['uploadLogo', 'admin', uploadLogoAction, logo],
  ['removeLogo', 'admin', removeLogoAction, () => ({})],
  ['inviteMember', 'admin', inviteMemberAction, () => ({ email: 'a@b.co', role: 'member' })],
  ['revokeInvitation', 'admin', revokeInvitationAction, () => ({ invitationId: 'inv_1' })],
  ['changeRole', 'admin', changeRoleAction, () => ({ userId: 'u2', role: 'viewer' })],
  ['removeMember', 'admin', removeMemberAction, () => ({ userId: 'u2' })],
  ['createApiKey', 'admin', createApiKeyAction, () => ({ name: 'HR system' })],
  ['revokeApiKey', 'admin', revokeApiKeyAction, () => ({ keyId: 'key_1' })],
  ['leaveWorkspace', 'viewer', leaveWorkspaceAction, () => ({})],
];

const ORDER: Role[] = ['viewer', 'member', 'admin', 'owner'];

function withWorkspace(input: unknown, workspaceId = WORKSPACE.id) {
  if (input instanceof FormData) {
    input.set('workspaceId', workspaceId);
    return input;
  }
  return { ...(input as object), workspaceId };
}

beforeEach(() => {
  state.user = { id: 'u1', name: 'Asha', email: 'asha@example.com', image: null };
  state.role = 'owner';
  state.singleWorkspace = false;
  state.workspaceCount = 0;
  state.calls = [];
});

describe.each(workspaceActions)('%s', (_name, minimum, action, input) => {
  it('refuses a visitor without a session', async () => {
    state.user = null;
    expect(await action(withWorkspace(input()))).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect(state.calls).toEqual([]);
  });

  it('treats a workspace the user is not in as missing', async () => {
    state.role = null;
    expect(await action(withWorkspace(input()))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    state.role = 'owner';
    expect(await action(withWorkspace(input(), 'ws_other'))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await action(input())).toMatchObject({ code: 'NOT_FOUND' });
    expect(state.calls).toEqual([]);
  });

  it(`runs for ${minimum} and above, and refuses lower roles`, async () => {
    for (const role of ORDER) {
      state.role = role;
      state.calls = [];
      const result = await action(withWorkspace(input()));
      if (ORDER.indexOf(role) >= ORDER.indexOf(minimum)) {
        expect(result, role).toMatchObject({ ok: true });
        expect(state.calls.length, role).toBeGreaterThan(0);
      } else {
        expect(result, role).toMatchObject({ ok: false, code: 'FORBIDDEN' });
        expect(state.calls, role).toEqual([]);
      }
    }
  });
});

describe('input checks', () => {
  it('points at the field to fix', async () => {
    const result = await updateBrandAction(
      withWorkspace({ brandColor: 'blue', font: 'inter', senderName: '' }),
    );
    expect(result).toEqual({
      ok: false,
      code: 'VALIDATION',
      error: 'Use a colour like #1B6AE0',
      field: 'brandColor',
    });
    expect(
      await inviteMemberAction(withWorkspace({ email: 'a@b.co', role: 'root' })),
    ).toMatchObject({ code: 'VALIDATION', field: 'role' });
    expect(await uploadLogoAction(withWorkspace({}))).toMatchObject({
      code: 'VALIDATION',
      field: 'logo',
    });
    expect(state.calls).toEqual([]);
  });

  it('hides unexpected failures behind a plain message', async () => {
    const workspaces = await import('../workspaces');
    vi.spyOn(workspaces, 'renameWorkspace').mockRejectedValueOnce(new Error('db down: secret'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await renameWorkspaceAction(withWorkspace({ name: 'X' }));
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(error).toHaveBeenCalled();
  });
});

describe('user actions', () => {
  it('need a session', async () => {
    state.user = null;
    for (const result of [
      await createWorkspaceAction({ name: 'Acme' }),
      await acceptInvitationAction({ token: 'x' }),
      await updatePreferencesAction({ theme: 'dark' }),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    }
    expect(state.calls).toEqual([]);
  });

  it('create a workspace and return where to go', async () => {
    expect(await createWorkspaceAction({ name: 'Acme' })).toEqual({
      ok: true,
      data: { slug: 'acme' },
    });
  });

  it('allow only one workspace on a single-workspace install', async () => {
    state.singleWorkspace = true;
    expect((await createWorkspaceAction({ name: 'First' })).ok).toBe(true);
    state.workspaceCount = 1;
    expect(await createWorkspaceAction({ name: 'Second' })).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('accept an invitation and save preferences', async () => {
    expect(await acceptInvitationAction({ token: 'abc' })).toEqual({
      ok: true,
      data: { workspaceSlug: 'acme' },
    });
    expect(await updatePreferencesAction({ theme: 'dark' })).toMatchObject({ ok: true });
  });
});
