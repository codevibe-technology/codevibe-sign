import { describe, expect, it } from 'vitest';
import { createSignClient, createVerifyClient, type CreateTemplateInput } from '.';
import { API_KEY, BASE_URL, PNG, fakeEngine, fakePdf, testServer } from './test/server';

const decoder = new TextDecoder();

function offer(overrides: Partial<CreateTemplateInput> = {}): CreateTemplateInput {
  return {
    name: 'Offer letter',
    description: 'Standard offer',
    documents: [{ key: 'offer', name: 'offer.pdf', content: fakePdf(2) }],
    roles: [
      { key: 'employee', name: 'Employee', auth: 'email_link' },
      { key: 'hr', name: 'HR', type: 'viewer' },
    ],
    fields: [
      { role: 'employee', type: 'signature', page: 1, x: 72, y: 600, width: 180, height: 48 },
      {
        role: 'employee',
        type: 'text',
        label: 'Employee code',
        page: 0,
        x: 72,
        y: 100,
        width: 200,
        height: 20,
        required: false,
      },
    ],
    ...overrides,
  };
}

const people = {
  Employee: { name: 'Asha Rao', email: 'asha@example.com' },
  HR: { name: 'HR Team', email: 'hr@example.com' },
};

function setup() {
  const env = testServer({
    pdf: {
      ...fakeEngine,
      sealCertificate: () => ({ sha256: 'c'.repeat(64) }),
      verify: async (pdf) =>
        decoder.decode(pdf).endsWith('sealed\n')
          ? { valid: true, signer: { commonName: 'Test Seal' }, certificateSha256: 'c'.repeat(64) }
          : { valid: false, reason: 'not_sealed' },
    },
  });
  const client = createSignClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: env.fetch });
  return { env, client };
}

describe('templates through the client', () => {
  it('creates, lists, gets, updates and deletes a template', async () => {
    const { client } = setup();
    const template = await client.templates.create(offer());
    expect(template).toMatchObject({ name: 'Offer letter', title: 'Offer letter' });
    expect(template.documents[0]).toMatchObject({ name: 'offer.pdf', pageCount: 2 });
    expect(template.fields.map((f) => f.roleId)).toEqual([
      template.roles[0]!.id,
      template.roles[0]!.id,
    ]);

    await client.templates.create(offer({ name: 'NDA' }));
    const page = await client.templates.list({ limit: 1 });
    expect(page.templates.map((t) => t.name)).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const rest = await client.templates.list({ limit: 1, cursor: page.nextCursor! });
    expect(rest.nextCursor).toBeNull();
    expect((await client.templates.list({ q: 'nda' })).templates).toHaveLength(1);
    expect((await client.templates.list()).templates).toHaveLength(2);

    expect((await client.templates.get(template.id)).id).toBe(template.id);
    const changed = await client.templates.update(template.id, {
      name: 'Offer letter 2026',
      description: null,
    });
    expect(changed.name).toBe('Offer letter 2026');
    expect(changed.description).toBeUndefined();

    await expect(client.templates.delete(template.id)).resolves.toBeUndefined();
    await expect(client.templates.get(template.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('makes an envelope from a template with people and prefilled values', async () => {
    const { client } = setup();
    const template = await client.templates.create(offer());
    const envelope = await client.templates.createEnvelope(template.id, {
      roles: people,
      prefill: { 'Employee code': 'E-1042' },
      expiresAt: new Date(Date.now() + 86_400_000),
      send: true,
    });
    expect(envelope.status).toBe('sent');
    expect(envelope.metadata).toEqual({ templateId: template.id });
    expect(envelope.recipients.map((r) => r.name)).toEqual(['Asha Rao', 'HR Team']);
    expect(envelope.values.map((v) => v.value)).toEqual(['E-1042']);

    await expect(
      client.templates.createEnvelope(template.id, { roles: { Employee: people.Employee } }),
    ).rejects.toMatchObject({ code: 'VALIDATION', issues: [{ path: 'roles.HR' }] });
  });

  it('does not repeat a delete, and replays a retried create', async () => {
    const { env, client } = setup();
    const template = await client.templates.create(offer());
    const posts = env.requests.filter((r) => r.method === 'POST');
    expect(posts[0]!.headers.get('idempotency-key')).toBeTruthy();
    await client.templates.delete(template.id);
    const deletes = env.requests.filter((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.headers.get('idempotency-key')).toBeNull();
  });
});

describe('public verification through the client', () => {
  async function sealedFile(
    client: ReturnType<typeof setup>['client'],
    env: ReturnType<typeof setup>['env'],
  ) {
    const template = await client.templates.create(
      offer({ roles: [{ key: 'employee', name: 'Employee', auth: 'email_link' }] }),
    );
    const envelope = await client.templates.createEnvelope(template.id, {
      roles: { Employee: people.Employee },
      send: true,
    });
    const token = env.tokenFor('asha@example.com');
    const signature = envelope.fields.find((f) => f.type === 'signature')!;
    const res = await env.fetch(`${BASE_URL}/v1/sign/${token}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consent: true, values: [{ fieldId: signature.id, value: PNG }] }),
    });
    expect(res.status).toBe(200);
    return {
      envelope,
      bytes: await client.envelopes.downloadDocument(envelope.id, envelope.documents[0]!.id, {
        version: 'sealed',
      }),
    };
  }

  it('verifies a sealed file by upload and by hash without sending the API key', async () => {
    const { env, client } = setup();
    const { envelope, bytes } = await sealedFile(client, env);
    const before = env.requests.length;

    const anyone = createVerifyClient({ baseUrl: BASE_URL, fetch: env.fetch });
    const byFile = await anyone.pdf(bytes);
    expect(byFile).toMatchObject({ valid: true, reason: null, envelope: { id: envelope.id } });
    expect(await client.verify.sha256(byFile.sha256)).toEqual(byFile);
    expect(await client.verify.pdf(new Blob([bytes as BlobPart]))).toEqual(byFile);

    const plain = await anyone.pdf(fakePdf());
    expect(plain).toMatchObject({ valid: false, reason: 'not_sealed', envelope: null });
    expect((await anyone.sha256('0'.repeat(64))).reason).toBe('unknown_document');
    await expect(anyone.sha256('nope')).rejects.toMatchObject({ code: 'VALIDATION' });

    for (const request of env.requests.slice(before)) {
      expect(request.headers.get('authorization')).toBeNull();
    }
  });
});
