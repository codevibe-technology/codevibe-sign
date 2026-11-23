import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it, vi } from 'vitest';
import { operations, successResponse } from './model.ts';
import { spec } from './openapi.ts';
import {
  isLoopbackHost,
  isSandboxTarget,
  mockResponse,
  modelFor,
  requestPath,
  sandboxAvailable,
  sandboxResponse,
  type TryItInput,
  type TryItModel,
} from './tryit.ts';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(spec, 'openapi');
const validatorFor = (schema: object) =>
  ajv.compile(
    JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"openapi#/components/')),
  );

function inputFor(model: TryItModel): TryItInput {
  return {
    path: Object.fromEntries(model.pathParams.map((p) => [p.name, p.example])),
    query: Object.fromEntries(model.queryParams.map((p) => [p.name, p.example])),
    body: model.body ?? '',
  };
}

const create = () => modelFor('createEnvelope')!;

describe('where Try it may send requests', () => {
  it('knows loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'docs.localhost', 'LOCALHOST']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ['sign.codevibe.in', 'localhost.evil.com', '10.0.0.1', '127.0.0.2.nip.io']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it('accepts only plain http(s) targets on this machine', () => {
    expect(isSandboxTarget('http://localhost:3000')).toBe(true);
    expect(isSandboxTarget('http://127.0.0.1:5173/')).toBe(true);
    expect(isSandboxTarget('https://sign.codevibe.in/api')).toBe(false);
    expect(isSandboxTarget('http://user:secret@localhost:3000')).toBe(false);
    expect(isSandboxTarget('javascript:alert(1)')).toBe(false);
    expect(isSandboxTarget('file:///etc/passwd')).toBe(false);
    expect(isSandboxTarget('not a url')).toBe(false);
  });

  it('offers the sandbox only when the docs page itself is local', () => {
    expect(sandboxAvailable('sign.codevibe.in')).toBe(false);
    expect(sandboxAvailable('localhost')).toBe(true);
  });

  it('never calls fetch from the public site, whatever the target', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const model = create();
    await expect(
      sandboxResponse(
        model,
        inputFor(model),
        {
          baseUrl: 'http://localhost:3000',
          apiKey: 'k',
          pageHostname: 'sign.codevibe.in',
        },
        fetcher,
      ),
    ).rejects.toThrow(/run on your machine/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a live server even from local docs', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const model = create();
    await expect(
      sandboxResponse(
        model,
        inputFor(model),
        {
          baseUrl: 'https://sign.codevibe.in/api',
          apiKey: 'cvs_secret',
          pageHostname: 'localhost',
        },
        fetcher,
      ),
    ).rejects.toThrow(/on this machine/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('calls a local sandbox without cookies and with the key as a bearer token', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ id: 'x' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const model = create();
    const result = await sandboxResponse(
      model,
      inputFor(model),
      {
        baseUrl: 'http://localhost:3000/',
        apiKey: ' key-1234567890abcdef ',
        pageHostname: 'localhost',
      },
      fetcher,
    );
    expect(result.status).toBe(201);
    expect(result.mock).toBe(false);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/v1/envelopes');
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('manual');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer key-1234567890abcdef');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('mock answers', () => {
  it('answers every route with a response that fits its documented schema', () => {
    for (const op of operations()) {
      const model = modelFor(op.id)!;
      const result = mockResponse(model, inputFor(model));
      const success = successResponse(op)!;
      expect(result.status, op.id).toBe(Number(success.status));
      expect(result.mock).toBe(true);
      if (result.contentType !== 'application/json') continue;
      const validate = validatorFor(success.schema!);
      expect(
        validate(JSON.parse(result.body)),
        `${op.id}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    }
  });

  it('echoes the id typed into the form', () => {
    const model = modelFor('getEnvelope')!;
    const result = mockResponse(model, { ...inputFor(model), path: { id: 'env_typed' } });
    expect(JSON.parse(result.body).id).toBe('env_typed');
  });

  it('echoes a template id and a hash typed into the form', () => {
    const template = modelFor('getTemplate')!;
    const got = mockResponse(template, { ...inputFor(template), path: { templateId: 'tpl_x' } });
    expect(JSON.parse(got.body).id).toBe('tpl_x');
    const verify = modelFor('verifySha256')!;
    const hash = 'AB'.repeat(32);
    const checked = mockResponse(verify, { ...inputFor(verify), path: { sha256: hash } });
    expect(JSON.parse(checked.body).sha256).toBe(hash.toLowerCase());
    const bad = mockResponse(verify, { ...inputFor(verify), path: { sha256: 'not-a-hash' } });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error.details.issues[0].path).toBe('sha256');
  });

  it('answers the new routes without a key field or any request', () => {
    for (const id of ['verifyPdf', 'verifySha256']) expect(modelFor(id)!.needsKey).toBe(false);
    for (const id of ['listTemplates', 'createTemplate', 'createEnvelopeFromTemplate']) {
      expect(modelFor(id)!.needsKey, id).toBe(true);
    }
    const remove = modelFor('deleteTemplate')!;
    expect(remove.method).toBe('DELETE');
    expect(JSON.parse(mockResponse(remove, inputFor(remove)).body)).toMatchObject({
      deleted: true,
    });
    const from = modelFor('createEnvelopeFromTemplate')!;
    const refused = mockResponse(from, { ...inputFor(from), body: '{"send":true}' });
    expect(JSON.parse(refused.body).error.details.issues).toEqual([
      { path: 'roles', message: 'roles is required' },
    ]);
  });

  it('runs a file upload as a mock only, never against a server', async () => {
    const model = modelFor('verifyPdf')!;
    expect(model.upload).toBe(true);
    expect(model.body).toBeUndefined();
    expect(JSON.parse(mockResponse(model, inputFor(model)).body)).toMatchObject({ valid: true });
    const fetcher = vi.fn();
    await expect(
      sandboxResponse(
        model,
        inputFor(model),
        { baseUrl: 'http://localhost:3000', apiKey: '', pageHostname: 'localhost' },
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/takes a file/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a missing path parameter like the server', () => {
    const model = modelFor('getEnvelope')!;
    const result = mockResponse(model, { ...inputFor(model), path: { id: '  ' } });
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body).error).toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a body that is not JSON, not an object, or misses a required field', () => {
    const model = create();
    for (const body of ['{', '[]', '{"title":"Offer"}']) {
      const result = mockResponse(model, { ...inputFor(model), body });
      expect(result.status, body).toBe(400);
      const error = JSON.parse(result.body).error;
      expect(error.code).toBe('VALIDATION');
      expect(error.details.issues.length).toBeGreaterThan(0);
    }
    const missing = JSON.parse(
      mockResponse(model, { ...inputFor(model), body: '{"title":"Offer"}' }).body,
    );
    expect(missing.error.details.issues.map((i: { path: string }) => i.path)).toEqual([
      'documents',
      'recipients',
    ]);
  });

  it('builds the request path with encoded parameters and only filled query values', () => {
    const model = modelFor('listEnvelopes')!;
    expect(
      requestPath(model, { path: {}, query: { status: 'sent', q: '', limit: '10' }, body: '' }),
    ).toBe('/v1/envelopes?status=sent&limit=10');
    const get = modelFor('getEnvelope')!;
    expect(requestPath(get, { path: { id: 'a/b' }, query: {}, body: '' })).toBe(
      '/v1/envelopes/a%2Fb',
    );
  });
});
