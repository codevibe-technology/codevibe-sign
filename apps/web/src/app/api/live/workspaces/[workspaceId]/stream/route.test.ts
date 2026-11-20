import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeChange } from '@/server/live/events';
import { createLiveHub, type LiveHub } from '@/server/live/hub';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  members: new Map<string, string[]>(),
  hub: null as LiveHub | null,
  notify: (() => {}) as (payload: string) => void,
}));

vi.mock('@/server/auth/session', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/db', () => ({ db: () => ({}) }));
vi.mock('@/server/live/live', () => ({ liveHub: () => state.hub }));
vi.mock('@/server/workspaces', () => ({
  findMembership: async (_sql: unknown, userId: string, by: { id: string }) =>
    state.members.get(userId)?.includes(by.id)
      ? { workspace: { id: by.id, slug: 's', name: 'n' }, role: 'viewer' }
      : null,
}));

const { GET } = await import('./route');

const open = (workspaceId: string, signal = new AbortController().signal) =>
  GET(new Request(`http://app.test/api/live/workspaces/${workspaceId}/stream`, { signal }), {
    params: Promise.resolve({ workspaceId }),
  });

async function readFrames(res: Response, count: number) {
  const reader = res.body!.getReader();
  let text = '';
  for (let i = 0; i < count; i++) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  return text;
}

beforeEach(() => {
  state.user = { id: 'u_asha' };
  state.members = new Map([['u_asha', ['ws_acme']]]);
  state.hub = createLiveHub(async (_c, message, ready) => {
    state.notify = message;
    ready();
  });
});

describe('GET /api/live/workspaces/[workspaceId]/stream', () => {
  it('refuses visitors without a session', async () => {
    state.user = null;
    expect((await open('ws_acme')).status).toBe(401);
  });

  it('answers 404 for a workspace the user is not a member of, and never subscribes', async () => {
    const res = await open('ws_globex');
    expect(res.status).toBe(404);
    expect(state.hub!.size()).toBe(0);
  });

  it("streams the member's workspace only", async () => {
    const res = await open('ws_acme');
    expect(res.status).toBe(200);
    const change = (w: string, e: string) =>
      state.notify(encodeChange({ workspaceId: w, envelopeId: e, actions: ['envelope.sent'] })!);
    change('ws_globex', 'env_globex');
    change('ws_acme', 'env_acme');
    const text = await readFrames(res, 3);
    expect(text).toContain('env_acme');
    expect(text).not.toContain('env_globex');
  });

  it('answers 503 when the listener cannot start', async () => {
    state.hub = createLiveHub(async () => {
      throw new Error('database down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await open('ws_acme')).status).toBe(503);
  });
});
