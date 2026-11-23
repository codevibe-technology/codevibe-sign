import { HttpError } from '@codevibe_technology/sign-server';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import { createAuthenticate, inProcess } from './principal';

const APP = 'https://sign.example.com';

function setup(role: Role | null = 'member', sent: string[] = [], withName = false) {
  return createAuthenticate({
    isSender: async (userId, workspaceId, envelopeId) =>
      userId === 'u1' && workspaceId === 'ws_a' && sent.includes(envelopeId),
    appUrl: APP,
    resolveApiKey: async (key) =>
      key === 'cvs_good' ? { id: 'key_1', workspaceId: 'ws_a' } : null,
    sessionUser: async (headers) =>
      headers.get('cookie') === 'session'
        ? { id: 'u1', email: 'asha@example.com', ...(withName ? { name: 'Asha Rao' } : {}) }
        : null,
    roleOf: async (userId, workspaceId) =>
      userId === 'u1' && workspaceId === 'ws_a' ? role : null,
  });
}

const request = (method: string, headers: Record<string, string>) =>
  new Request(`${APP}/api/v1/envelopes`, { method, headers });

const refusal = async (promise: Promise<unknown>) => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return (err as HttpError).code;
};

describe('createAuthenticate', () => {
  it('resolves a workspace API key', async () => {
    const auth = setup();
    expect(await auth(request('POST', { authorization: 'Bearer cvs_good' }))).toEqual({
      id: 'key_1',
      workspaceId: 'ws_a',
    });
    expect(await refusal(auth(request('GET', { authorization: 'Bearer cvs_bad' })))).toBe(
      'UNAUTHORIZED',
    );
  });

  it('falls back when there is no key and no workspace header', async () => {
    expect(await setup()(request('GET', { cookie: 'session' }))).toBeNull();
  });

  it('acts for a signed-in member in the named workspace', async () => {
    const principal = await setup()(
      request('POST', { cookie: 'session', 'x-workspace': 'ws_a', origin: APP }),
    );
    expect(principal).toEqual({
      id: 'user:u1',
      workspaceId: 'ws_a',
      readOnly: false,
      actorName: 'asha@example.com',
    });
  });

  it('makes viewers read-only', async () => {
    const principal = await setup('viewer')(
      request('GET', { cookie: 'session', 'x-workspace': 'ws_a' }),
    );
    expect(principal?.readOnly).toBe(true);
  });

  it('refuses writes from another origin', async () => {
    const auth = setup();
    for (const origin of ['https://evil.example', '']) {
      const headers: Record<string, string> = { cookie: 'session', 'x-workspace': 'ws_a' };
      if (origin) headers.origin = origin;
      expect(await refusal(auth(request('POST', headers)))).toBe('FORBIDDEN');
    }
  });

  it('refuses people outside the workspace and visitors without a session', async () => {
    const auth = setup();
    const outsider = request('GET', { cookie: 'session', 'x-workspace': 'ws_b' });
    expect(await refusal(auth(outsider))).toBe('UNAUTHORIZED');
    const anonymous = request('GET', { 'x-workspace': 'ws_a' });
    expect(await refusal(auth(anonymous))).toBe('UNAUTHORIZED');
  });

  it('honours principals attached in-process, and only to that request', async () => {
    const auth = setup(null);
    const local = request('POST', {});
    inProcess.set(local, { id: 'user:u9', workspaceId: 'ws_z' });
    expect(await auth(local)).toEqual({ id: 'user:u9', workspaceId: 'ws_z' });
    expect(await auth(request('POST', {}))).toBeNull();
  });

  it('lets members void only envelopes they sent, and admins any', async () => {
    const voiding = (id: string) =>
      new Request(`${APP}/api/v1/envelopes/${id}/void`, {
        method: 'POST',
        headers: { cookie: 'session', 'x-workspace': 'ws_a', origin: APP },
      });
    const member = setup('member', ['env_mine']);
    expect(await member(voiding('env_mine'))).toMatchObject({ id: 'user:u1' });
    expect(await refusal(member(voiding('env_other')))).toBe('FORBIDDEN');
    expect(await setup('admin')(voiding('env_other'))).toMatchObject({ id: 'user:u1' });
    expect(await setup('viewer')(voiding('env_mine'))).toMatchObject({ readOnly: true });
  });
});

describe('inProcess', () => {
  it('is one map however many times the module is loaded', async () => {
    const first = (await import('./principal')).inProcess;
    vi.resetModules();
    const second = (await import('./principal')).inProcess;
    expect(second).toBe(first);
  });
});

describe('fixing envelopes after sending', () => {
  const at = (path: string) =>
    new Request(`${APP}/api/v1/envelopes/${path}`, {
      method: 'POST',
      headers: { cookie: 'session', 'x-workspace': 'ws_a', origin: APP },
    });

  it('lets only admins and owners take a signing link to share', async () => {
    expect(await refusal(setup('member')(at('env_1/recipients/r1/link')))).toBe('FORBIDDEN');
    expect(await setup('admin')(at('env_1/recipients/r1/link'))).toMatchObject({
      workspaceId: 'ws_a',
    });
  });

  it('lets members recall or revise only what they sent', async () => {
    expect(await refusal(setup('member')(at('env_1/recall')))).toBe('FORBIDDEN');
    expect(await refusal(setup('member')(at('env_1/revise')))).toBe('FORBIDDEN');
    expect(await setup('member', ['env_1'])(at('env_1/recall'))).toMatchObject({
      readOnly: false,
    });
    expect(await setup('admin')(at('env_1/revise'))).toMatchObject({ readOnly: false });
  });

  it('names the signed-in user for the audit trail', async () => {
    expect(await setup('admin', [], true)(at('env_1/recipients/r1/link'))).toMatchObject({
      actorName: 'Asha Rao',
    });
  });

  it('falls back to their email address only when they have saved no name', async () => {
    expect(await setup('admin')(at('env_1/recipients/r1/link'))).toMatchObject({
      actorName: 'asha@example.com',
    });
  });
});
