import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import { AppError } from '../errors';

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; image: null } | null,
  role: null as Role | null,
  mine: new Set<string>(),
  calls: [] as string[],
  recipientEmail: 'asha@example.com',
  failVoid: null as string | null,
}));

const WORKSPACE = { id: 'ws_1', slug: 'acme', name: 'Acme' };

vi.mock('../auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('../db', () => ({ db: () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('../workspaces', () => ({
  findMembership: async (_sql: unknown, _userId: string, by: { id: string }) =>
    state.role && by.id === WORKSPACE.id ? { workspace: WORKSPACE, role: state.role } : null,
}));
vi.mock('../envelopes', () => ({
  sentBy: async (_sql: unknown, _ws: string, _user: string, ids: string[]) =>
    new Set(ids.filter((id) => state.mine.has(id))),
  recordSender: async (_sql: unknown, input: { envelopeId: string; userId: string }) => {
    state.calls.push(`recordSender:${input.envelopeId}:${input.userId}`);
  },
  findSealedDocument: async () => {
    state.calls.push('findSealedDocument');
    return null;
  },
}));
vi.mock('../pdf', () => ({
  inspectUpload: async () => {
    state.calls.push('inspect');
    return { pageCount: 1, pages: [{ width: 595, height: 842 }] };
  },
  verifyUpload: async () => {
    state.calls.push('verify');
    return {
      valid: true,
      summary: 'Authentic.',
      reason: null,
      signer: null,
      signedAt: null,
      sha256: 'x',
    };
  },
}));
vi.mock('../plans', () => ({
  workspacePlan: async () => ({}),
  assertWithin: () => undefined,
}));
vi.mock('../sign/api', () => ({
  userPrincipal: (
    userId: string,
    workspaceId: string,
    _readOnly?: boolean,
    actorName?: string,
  ) => ({
    id: `user:${userId}`,
    workspaceId,
    ...(actorName ? { actorName } : {}),
  }),
  signApi: (principal: { actorName?: string }) => ({
    shareLink: async (id: string, recipientId: string) => {
      state.calls.push(`share:${id}:${recipientId}:${principal.actorName ?? ''}`);
      return { recipientId, url: 'https://sign.example.com/api/sign/secret' };
    },
    correctRecipient: async (id: string, recipientId: string, body: { email?: string }) => {
      state.calls.push(`correct:${id}:${recipientId}:${body.email ?? ''}`);
      return { recipients: [{ id: recipientId, notifiedAt: 'later' }] };
    },
    recall: async (id: string, note?: string) => {
      state.calls.push(`recall:${id}:${note ?? ''}:${principal.actorName ?? ''}`);
      return { draft: { id: 'env_copy' }, recalled: { id } };
    },
    revise: async (id: string) => {
      state.calls.push(`revise:${id}`);
      return { draft: { id: 'env_rev' }, declined: { id } };
    },
    void: async (id: string) => {
      if (state.failVoid === id) throw new AppError('CONFLICT', 'Envelope is already completed');
      state.calls.push(`void:${id}`);
    },
    get: async () => ({
      recipients: [{ id: 'r1', email: state.recipientEmail }],
    }),
    remind: async (id: string, recipientId?: string) => {
      state.calls.push(`remind:${id}:${recipientId ?? 'all'}`);
      return { recipients: [{ id: 'r1', lastRemindedAt: 'now' }] };
    },
  }),
}));

const {
  correctRecipientAction,
  inspectDocumentAction,
  recallEnvelopeAction,
  remindAction,
  reviseEnvelopeAction,
  shareLinkAction,
  verifyDocumentAction,
  voidEnvelopesAction,
} = await import('./envelopes');

const ORDER: Role[] = ['viewer', 'member', 'admin', 'owner'];
const pdf = () => {
  const form = new FormData();
  form.set('workspaceId', WORKSPACE.id);
  form.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'offer.pdf'));
  return form;
};

beforeEach(() => {
  state.user = { id: 'u1', name: 'Asha', email: 'Asha@example.com', image: null };
  state.role = 'member';
  state.mine = new Set(['env_mine']);
  state.calls = [];
  state.failVoid = null;
});

describe('envelope actions need a session and membership', () => {
  const all = [
    () => inspectDocumentAction(pdf()),
    () => verifyDocumentAction(pdf()),
    () =>
      voidEnvelopesAction({ workspaceId: WORKSPACE.id, envelopeIds: ['env_mine'], reason: 'x' }),
    () => remindAction({ workspaceId: WORKSPACE.id, envelopeId: 'env_mine' }),
  ];

  it.each(all.map((fn, i) => [i, fn]))(
    'action %i refuses visitors and outsiders',
    async (_i, fn) => {
      state.user = null;
      expect(await fn()).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
      state.user = { id: 'u1', name: 'Asha', email: 'asha@example.com', image: null };
      state.role = null;
      expect(await fn()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect(state.calls).toEqual([]);
    },
  );
});

describe('inspectDocumentAction', () => {
  it('is for members and above', async () => {
    for (const role of ORDER) {
      state.role = role;
      const result = await inspectDocumentAction(pdf());
      expect(result.ok, role).toBe(role !== 'viewer');
    }
  });

  it('asks for a file', async () => {
    expect(await inspectDocumentAction({ workspaceId: WORKSPACE.id })).toMatchObject({
      code: 'VALIDATION',
      field: 'file',
    });
  });
});

describe('verifyDocumentAction', () => {
  it('lets every role check a document', async () => {
    for (const role of ORDER) {
      state.role = role;
      expect(await verifyDocumentAction(pdf()), role).toMatchObject({
        ok: true,
        data: { valid: true, fileName: 'offer.pdf' },
      });
    }
  });
});

describe('voidEnvelopesAction', () => {
  const input = (envelopeIds: string[], reason = 'Sent to the wrong person') => ({
    workspaceId: WORKSPACE.id,
    envelopeIds,
    reason,
  });

  it('refuses viewers', async () => {
    state.role = 'viewer';
    expect(await voidEnvelopesAction(input(['env_mine']))).toMatchObject({ code: 'FORBIDDEN' });
    expect(state.calls).toEqual([]);
  });

  it('lets members void what they sent, not what others sent', async () => {
    expect(await voidEnvelopesAction(input(['env_mine']))).toEqual({
      ok: true,
      data: { voided: ['env_mine'], failed: [] },
    });
    state.calls = [];
    expect(await voidEnvelopesAction(input(['env_other']))).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
      error: 'Only an admin can void an envelope someone else sent.',
    });
    expect(state.calls).toEqual([]);
  });

  it('lets admins and owners void anything, reporting the ones that fail', async () => {
    for (const role of ['admin', 'owner'] as const) {
      state.role = role;
      state.calls = [];
      state.failVoid = 'env_done';
      const result = await voidEnvelopesAction(input(['env_other', 'env_done', 'env_other']));
      expect(result, role).toEqual({
        ok: true,
        data: {
          voided: ['env_other'],
          failed: [{ id: 'env_done', error: 'Envelope is already completed' }],
        },
      });
    }
  });

  it('needs a reason and at most 100 envelopes', async () => {
    expect(await voidEnvelopesAction(input(['env_mine'], '   '))).toMatchObject({
      code: 'VALIDATION',
      field: 'reason',
    });
    expect(await voidEnvelopesAction(input([]))).toMatchObject({ field: 'envelopeIds' });
    const many = Array.from({ length: 101 }, (_, i) => `e${i}`);
    expect(await voidEnvelopesAction(input(many))).toMatchObject({ field: 'envelopeIds' });
    expect(state.calls).toEqual([]);
  });
});

describe('remindAction', () => {
  it('lets members remind anyone whose turn it is', async () => {
    expect(await remindAction({ workspaceId: WORKSPACE.id, envelopeId: 'e1' })).toEqual({
      ok: true,
      data: { reminded: 1 },
    });
    expect(state.calls).toEqual(['remind:e1:all']);
  });

  it('lets a viewer ask only for their own link again', async () => {
    state.role = 'viewer';
    expect(
      await remindAction({ workspaceId: WORKSPACE.id, envelopeId: 'e1', recipientId: 'r1' }),
    ).toMatchObject({ ok: true });
    state.recipientEmail = 'someone@else.com';
    expect(
      await remindAction({ workspaceId: WORKSPACE.id, envelopeId: 'e1', recipientId: 'r1' }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await remindAction({ workspaceId: WORKSPACE.id, envelopeId: 'e1' })).toMatchObject({
      code: 'FORBIDDEN',
    });
    state.recipientEmail = 'asha@example.com';
    expect(state.calls).toEqual(['remind:e1:r1']);
  });
});

describe('shareLinkAction', () => {
  it('is for admins and owners only, and names them in the audit trail', async () => {
    const input = { workspaceId: WORKSPACE.id, envelopeId: 'env_1', recipientId: 'r1' };
    for (const role of ORDER) {
      state.role = role;
      state.calls = [];
      const result = await shareLinkAction(input);
      if (role === 'admin' || role === 'owner') {
        expect(result).toEqual({
          ok: true,
          data: { url: 'https://sign.example.com/api/sign/secret' },
        });
        expect(state.calls).toEqual(['share:env_1:r1:Asha']);
      } else {
        expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
        expect(state.calls).toEqual([]);
      }
    }
  });
});

describe('correctRecipientAction', () => {
  it('lets senders correct and reports a new invitation', async () => {
    const input = {
      workspaceId: WORKSPACE.id,
      envelopeId: 'env_1',
      recipientId: 'r1',
      name: 'Asha',
      email: 'asha.rao@example.com',
    };
    state.role = 'viewer';
    expect(await correctRecipientAction(input)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    state.role = 'member';
    expect(await correctRecipientAction(input)).toEqual({ ok: true, data: { invited: true } });
    expect(state.calls).toContain('correct:env_1:r1:asha.rao@example.com');
  });
});

describe('recall and revise', () => {
  it('copy what the member sent and record them as the sender of the draft', async () => {
    const recalled = await recallEnvelopeAction({
      workspaceId: WORKSPACE.id,
      envelopeId: 'env_mine',
      note: 'Wrong date',
    });
    expect(recalled).toEqual({ ok: true, data: { draftId: 'env_copy' } });
    expect(state.calls).toEqual(['recall:env_mine:Wrong date:Asha', 'recordSender:env_copy:u1']);
    const revised = await reviseEnvelopeAction({
      workspaceId: WORKSPACE.id,
      envelopeId: 'env_mine',
    });
    expect(revised).toEqual({ ok: true, data: { draftId: 'env_rev' } });
  });

  it('refuse a member for an envelope someone else sent, but not an admin', async () => {
    const input = { workspaceId: WORKSPACE.id, envelopeId: 'env_other' };
    expect(await recallEnvelopeAction(input)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await reviseEnvelopeAction(input)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(state.calls).toEqual([]);
    state.role = 'admin';
    expect(await recallEnvelopeAction(input)).toMatchObject({ ok: true });
  });
});
