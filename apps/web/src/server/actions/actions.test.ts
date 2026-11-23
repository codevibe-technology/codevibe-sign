import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; image: null } | null,
  role: null as Role | null,
  singleWorkspace: false,
  workspaceCount: 0,
  calls: [] as string[],
  signingArgs: [] as unknown[],
  inviterName: '',
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
vi.mock('../workspace-address', () => ({
  changeWorkspaceAddress: record('changeWorkspaceAddress', { from: 'acme', to: 'acme-hr' }),
}));
vi.mock('../brand', () => ({
  updateBrand: record('updateBrand'),
  updateEmailSettings: record('updateEmailSettings'),
  updateSigningSettings: async (...args: unknown[]) => {
    state.calls.push('updateSigningSettings');
    state.signingArgs = args;
  },
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
vi.mock('../mail', () => ({
  sendInvitation: async (_mailer: unknown, input: { inviterName: string }) => {
    state.calls.push('sendInvitation');
    state.inviterName = input.inviterName;
  },
}));
vi.mock('../api-keys', () => ({
  createApiKey: record('createApiKey', { id: 'key_1', key: 'cvs_x', prefix: 'cvs_x' }),
  revokeApiKey: record('revokeApiKey'),
}));
vi.mock('../preferences', () => ({
  updatePreferences: record('updatePreferences', { theme: 'dark', timezone: null, locale: 'en' }),
}));

vi.mock('../profile', async (original) => ({
  ...(await original<typeof import('../profile')>()),
  setOwnName: async (_sql: unknown, userId: string, name: string) => {
    state.calls.push(`setOwnName:${userId}:${name}`);
    return name;
  },
}));

const { createApiKeyAction, revokeApiKeyAction } = await import('./api-keys');
const {
  removeLogoAction,
  updateBrandAction,
  updateEmailSettingsAction,
  updateSigningSettingsAction,
  uploadLogoAction,
} = await import('./brand');
const { updateNameAction, updatePreferencesAction } = await import('./personal');
const {
  acceptInvitationAction,
  changeRoleAction,
  inviteMemberAction,
  leaveWorkspaceAction,
  removeMemberAction,
  revokeInvitationAction,
} = await import('./team');
const { changeWorkspaceAddressAction, createWorkspaceAction, renameWorkspaceAction } = await import(
  './workspace'
);

const logo = () => {
  const form = new FormData();
  form.set('logo', new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
  return form;
};

/** Every workspace action, the lowest role allowed to use it, and a valid input. */
const workspaceActions: [string, Role, (input: unknown) => Promise<unknown>, () => unknown][] = [
  ['renameWorkspace', 'admin', renameWorkspaceAction, () => ({ name: 'New name' })],
  ['changeWorkspaceAddress', 'admin', changeWorkspaceAddressAction, () => ({ slug: 'acme-hr' })],
  [
    'updateBrand',
    'admin',
    updateBrandAction,
    () => ({ brandColor: '#123456', font: 'inter', senderName: 'Acme HR' }),
  ],
  ['uploadLogo', 'admin', uploadLogoAction, logo],
  [
    'updateEmailSettings',
    'admin',
    updateEmailSettingsAction,
    () => ({
      senderName: 'Acme HR',
      replyTo: 'hr@acme.test',
      overrides: { invite: { subject: 'Sign {{document_title}}', intro: '' } },
    }),
  ],
  [
    'updateSigningSettings',
    'admin',
    updateSigningSettingsAction,
    () => ({ showBadge: false, certificateFooter: 'Acme Pvt Ltd', signingDomain: '' }),
  ],
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

  it('refuses a mail kind that does not exist and a badge that is not a yes or no', async () => {
    expect(
      await updateEmailSettingsAction(
        withWorkspace({ senderName: '', replyTo: '', overrides: { welcome: { subject: 'x' } } }),
      ),
    ).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(
      await updateSigningSettingsAction(
        withWorkspace({ showBadge: 'yes', certificateFooter: '', signingDomain: '' }),
      ),
    ).toMatchObject({ ok: false, code: 'VALIDATION', field: 'showBadge' });
    expect(state.calls).toEqual([]);
  });

  it("checks the signing domain against the app's own host", async () => {
    await updateSigningSettingsAction(
      withWorkspace({ showBadge: true, certificateFooter: '', signingDomain: 'sign.acme.test' }),
    );
    expect(state.signingArgs.at(-1)).toBe('sign.example.com');
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
      await updateNameAction({ name: 'Asha Rao' }),
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

  it("save a tidied name on the signed-in person's own account only", async () => {
    const result = await updateNameAction({ name: '  Asha   Rao ', id: 'u2', userId: 'u2' });
    expect(result).toEqual({ ok: true, data: { name: 'Asha Rao' } });
    expect(state.calls).toEqual([`setOwnName:${state.user!.id}:Asha Rao`]);
  });

  it('refuse a name that breaks the rule, next to the field', async () => {
    for (const name of ['', '   ', 'A', 'a'.repeat(81), 'Asha\u0007Rao', 42]) {
      expect(await updateNameAction({ name })).toMatchObject({
        ok: false,
        code: 'VALIDATION',
        field: 'name',
      });
    }
    expect(state.calls).toEqual([]);
  });

  it('ask someone with no name for it before their first workspace, and save it first', async () => {
    state.user = { id: 'u9', name: '', email: 'ravi@example.com', image: null };
    expect(await createWorkspaceAction({ name: 'Acme' })).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      field: 'yourName',
      error: 'Enter your name',
    });
    expect(await createWorkspaceAction({ name: 'Acme', yourName: 'R' })).toMatchObject({
      ok: false,
      field: 'yourName',
    });
    expect(state.calls).toEqual([]);
    expect((await createWorkspaceAction({ name: 'Acme', yourName: ' Ravi  Kumar ' })).ok).toBe(
      true,
    );
    expect(state.calls).toEqual(['setOwnName:u9:Ravi Kumar', 'createWorkspace']);
  });

  it('leave a saved name alone when a workspace is created', async () => {
    expect((await createWorkspaceAction({ name: 'Acme', yourName: 'Someone Else' })).ok).toBe(true);
    expect(state.calls).toEqual(['createWorkspace']);
  });

  it('ask someone with no name for it when they accept an invitation', async () => {
    state.user = { id: 'u9', name: ' ', email: 'ravi@example.com', image: null };
    expect(await acceptInvitationAction({ token: 'abc' })).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      field: 'name',
    });
    expect(state.calls).toEqual([]);
    expect((await acceptInvitationAction({ token: 'abc', name: 'Ravi Kumar' })).ok).toBe(true);
    expect(state.calls).toEqual(['acceptInvitation', 'setOwnName:u9:Ravi Kumar']);
  });

  it('sign an invitation with the inviter’s name, or their email address without one', async () => {
    const invite = () => inviteMemberAction(withWorkspace({ email: 'a@b.co', role: 'member' }));
    state.user = { id: 'u1', name: ' Asha Rao ', email: 'asha@example.com', image: null };
    expect((await invite()).ok).toBe(true);
    expect(state.inviterName).toBe('Asha Rao');
    state.user = { id: 'u1', name: '', email: 'asha@example.com', image: null };
    expect((await invite()).ok).toBe(true);
    expect(state.inviterName).toBe('asha@example.com');
  });
});
