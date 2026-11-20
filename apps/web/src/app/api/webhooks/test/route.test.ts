import { describe, expect, it } from 'vitest';
import { SIGNATURE_HEADER } from '@codevibe_technology/sign-server';
import { GET, POST } from './route';

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://sign.example/api/webhooks/test', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );

describe('test webhook receiver', () => {
  it('accepts a signed delivery and names its event', async () => {
    const res = await post(JSON.stringify({ type: 'envelope.completed' }), {
      [SIGNATURE_HEADER]: 't=1,v1=x',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      event: 'envelope.completed',
      signed: true,
    });
  });

  it('reports an unsigned delivery as unsigned', async () => {
    const res = await post(JSON.stringify({ type: 'webhook.test' }));
    expect(await res.json()).toMatchObject({ received: true, signed: false });
  });

  it('refuses a body that is not JSON', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
  });

  it('refuses a body over 256 KB', async () => {
    const res = await post(JSON.stringify({ type: 'x', pad: 'a'.repeat(300 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('describes itself on GET', async () => {
    const res = GET();
    expect((await res.json()).receiver).toContain('test webhook receiver');
  });
});
