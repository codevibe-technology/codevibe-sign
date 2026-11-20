import { describe, expect, it, vi } from 'vitest';
import { base64Bytes, createPlanGate, readCreateBody } from './plan-gate';

const url = 'http://localhost:3000/api/v1/envelopes';

describe('readCreateBody', () => {
  it('reads the send flag and decoded sizes from a JSON body', async () => {
    const content = Buffer.alloc(1000, 7).toString('base64');
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send: true, documents: [{ name: 'a.pdf', content }, {}] }),
    });
    expect(await readCreateBody(request, 1 << 20)).toEqual({ send: true, sizes: [1000, 0] });
    expect(await request.json()).toMatchObject({ send: true });
  });

  it('reads files from a multipart body without using it up', async () => {
    const form = new FormData();
    form.set('envelope', JSON.stringify({ title: 'x' }));
    form.append('documents', new Blob([new Uint8Array(300)]), 'a.pdf');
    form.append('documents', new Blob([new Uint8Array(20)]), 'b.pdf');
    const request = new Request(url, { method: 'POST', body: form });
    expect(await readCreateBody(request, 1 << 20)).toEqual({ send: false, sizes: [300, 20] });
    expect((await request.formData()).getAll('documents')).toHaveLength(2);
  });

  it('leaves bodies it cannot read or that are too large to the server', async () => {
    const broken = new Request(url, { method: 'POST', body: '{not json' });
    expect(await readCreateBody(broken, 1 << 20)).toBeNull();
    const large = new Request(url, { method: 'POST', body: 'x'.repeat(2000) });
    expect(await readCreateBody(large, 1000)).toBeNull();
  });

  it('counts base64 padding', () => {
    expect(base64Bytes(Buffer.from('a').toString('base64'))).toBe(1);
    expect(base64Bytes(Buffer.from('ab').toString('base64'))).toBe(2);
    expect(base64Bytes(Buffer.from('abc').toString('base64'))).toBe(3);
  });
});

describe('createPlanGate', () => {
  it('forwards without looking at anything when self-hosted', async () => {
    const authenticate = vi.fn();
    const forward = vi.fn(async () => new Response(null, { status: 204 }));
    const gate = createPlanGate({
      sql: {} as never,
      settings: () => ({ mode: 'self-hosted', freeOverrides: {} }),
      authenticate,
      basePath: '/api',
      maxBodyBytes: 1000,
    });
    const res = await gate(
      new Request(url, { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}' }),
      forward,
    );
    expect(res.status).toBe(204);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('does not resolve the caller for reads made from the app', async () => {
    const authenticate = vi.fn();
    const forward = vi.fn(async () => new Response(null, { status: 200 }));
    const gate = createPlanGate({
      sql: {} as never,
      settings: () => ({ mode: 'hosted', freeOverrides: {} }),
      authenticate,
      basePath: '/api',
      maxBodyBytes: 1000,
    });
    await gate(new Request(`${url}/env_1`, { headers: { 'x-workspace': 'ws_1' } }), forward);
    expect(authenticate).not.toHaveBeenCalled();
    expect(forward).toHaveBeenCalledOnce();
  });
});
