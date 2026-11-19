import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultPdfEngine } from '../../src/engine';
import { harness, PNG, WEBHOOK_SECRET } from '../../src/testing/harness';
import { makeP12, makePdf } from '../../src/testing/real-pdf';
import { verifyWebhook } from '../../src/runtime/webhooks';
import spec from '../../openapi.json';

type Json = Record<string, unknown>;
type Operation = {
  operationId: string;
  responses: Record<string, Json>;
  requestBody?: Json;
};

const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const paths = spec.paths as unknown as Record<string, Record<string, Operation | unknown>>;

function operations(): { method: string; path: string; operation: Operation }[] {
  return Object.entries(paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((method) => ({
      method,
      path,
      operation: item[method] as Operation,
    })),
  );
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'openapi');
const compiled = new Map<string, ValidateFunction>();
/** Compiles a schema from the document, resolving its `#/components/...` references. */
function validator(schema: Json): ValidateFunction {
  const text = JSON.stringify(schema).replaceAll('"#/components/', '"openapi#/components/');
  let fn = compiled.get(text);
  if (!fn) {
    fn = ajv.compile(JSON.parse(text) as Json);
    compiled.set(text, fn);
  }
  return fn;
}

function deref(node: unknown): Json {
  let current = node as Json;
  while (typeof current?.$ref === 'string') {
    current = (current.$ref as string)
      .slice(2)
      .split('/')
      .reduce<unknown>((o, k) => (o as Json)[k], spec) as Json;
  }
  return current;
}

/** Finds the documented operation for a concrete request path. */
function match(method: string, url: string) {
  const path = url.split('?')[0]!;
  for (const entry of operations()) {
    if (entry.method !== method.toLowerCase()) continue;
    const pattern = new RegExp(`^${entry.path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    if (pattern.test(path)) return entry;
  }
  return undefined;
}

describe('the OpenAPI document', () => {
  it('is in sync with openapi.yaml and the Postman collection', () => {
    const source = parse(readFileSync(at('../../openapi.yaml'), 'utf8'));
    expect(spec).toEqual(source);
    execFileSync(process.execPath, [at('../../../../scripts/openapi.mjs'), '--check']);
  });

  it('lists exactly the routes the server registers', () => {
    const app = harness().server.app;
    const registered = new Set(
      app.routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    const documented = new Set(operations().map((o) => `${o.method.toUpperCase()} ${o.path}`));
    expect([...documented].sort()).toEqual([...registered].sort());
  });

  it('maps every error code to the status the server sends', async () => {
    const { statusFor } = await import('../../src/errors');
    const codes = spec.components.schemas.ErrorCode;
    for (const code of codes.enum) {
      expect(statusFor(code as never), code).toBe(
        (codes['x-status'] as Record<string, number>)[code],
      );
    }
  });

  it('has request examples that match their schemas', () => {
    for (const { operation } of operations()) {
      const media = deref(operation.requestBody)?.content as Json | undefined;
      const json = media?.['application/json'] as Json | undefined;
      if (!json) continue;
      const examples = [
        ...(json.example !== undefined ? [json.example] : []),
        ...Object.values((json.examples ?? {}) as Json).map((e) => deref(e).value),
      ];
      const validate = validator(json.schema as Json);
      for (const example of examples) {
        expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
      }
    }
  });
});

describe('a full run against the server', () => {
  let pdf: Uint8Array;
  let p12: Uint8Array;
  const seen = new Set<string>();

  beforeAll(async () => {
    pdf = await makePdf(2);
    p12 = makeP12('Contract Test Seal', 'pass');
  });

  function checked(h: ReturnType<typeof harness>) {
    return async (
      method: string,
      path: string,
      options: Parameters<typeof h.call>[2] = {},
    ): ReturnType<typeof h.call> => {
      const result = await h.call(method, path, options);
      const entry = match(method, path);
      expect(entry, `${method} ${path} is documented`).toBeDefined();
      const { operation } = entry!;
      seen.add(operation.operationId);
      const status = String(result.status);
      const response = operation.responses[status] ?? operation.responses[`${status[0]}XX`];
      expect(response, `${operation.operationId} documents ${status}`).toBeDefined();
      const contentType = result.res.headers.get('content-type') ?? '';
      const content = (deref(response).content ?? {}) as Json;
      if (contentType.includes('application/json')) {
        expect(
          content['application/json'],
          `${operation.operationId} ${status} is JSON`,
        ).toBeDefined();
        const schema = (content['application/json'] as Json).schema as Json;
        const validate = validator(schema);
        expect(
          validate(result.json),
          `${operation.operationId} ${status}: ${JSON.stringify(validate.errors)}`,
        ).toBe(true);
      } else if (contentType) {
        expect(Object.keys(content)).toContain(contentType.split(';')[0]);
      }
      if (status === '429')
        expect(Number(result.res.headers.get('retry-after'))).toBeGreaterThan(0);
      return result;
    };
  }

  it('answers every operation with a documented status and body', async () => {
    const h = harness({
      pdf: defaultPdfEngine,
      clock: { now: () => new Date() },
      sealer: { p12, passphrase: 'pass' },
    });
    const call = checked(h);
    const content = Buffer.from(pdf).toString('base64');

    await call('GET', '/health');
    const doc = await call('GET', '/v1/openapi.json');
    const etag = doc.res.headers.get('etag')!;
    expect(doc.res.headers.get('cache-control')).toBe('public, max-age=300');
    const cached = await call('GET', '/v1/openapi.json', { headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);

    const body = {
      title: 'Offer letter',
      metadata: { employeeId: 'E-1042' },
      documents: [{ key: 'offer', name: 'offer.pdf', content }],
      recipients: [
        { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
        { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', role: 'approver' },
        { key: 'hr', name: 'HR', email: 'hr@example.com', role: 'viewer' },
      ],
      fields: [
        { recipient: 'asha', type: 'signature', page: 1, x: 72, y: 600, width: 180, height: 48 },
        { recipient: 'asha', type: 'date_signed', page: 1, x: 72, y: 660, width: 120, height: 16 },
      ],
    };
    const created = await call('POST', '/v1/envelopes', {
      body,
      headers: { 'idempotency-key': 'create-1' },
    });
    expect(created.status).toBe(201);
    const replay = await call('POST', '/v1/envelopes', {
      body,
      headers: { 'idempotency-key': 'create-1' },
    });
    expect(replay.res.headers.get('idempotent-replayed')).toBe('true');
    const id = created.json.id as string;

    await call('GET', `/v1/envelopes/${id}`);
    const page = await call('GET', '/v1/envelopes?limit=1&status=draft');
    expect(page.json.envelopes[0].id).toBe(id);
    expect((await call('GET', '/v1/envelopes?limit=0')).status).toBe(400);
    await call('PATCH', `/v1/envelopes/${id}`, { body: { message: 'Please sign by Friday.' } });
    await call('POST', `/v1/envelopes/${id}/send`);

    const token = h.tokenFor('asha@example.com');
    const link = await call('GET', `/sign/${token}`);
    expect(link.status).toBe(303);
    await call('GET', `/v1/sign/${token}`);
    const locked = await call('GET', `/v1/sign/${token}/documents/${created.json.documents[0].id}`);
    expect(locked.json.error.code).toBe('OTP_INVALID');
    await call('POST', `/v1/sign/${token}/otp`);
    const session = await call('POST', `/v1/sign/${token}/otp/verify`, {
      body: { code: h.otp.sent.at(-1)!.code },
    });
    const headers = { 'x-sign-session': session.json.sessionToken as string };
    const view = await call('GET', `/v1/sign/${token}`, { headers });
    expect(view.json.authenticated).toBe(true);
    await call('GET', `/v1/sign/${token}/documents/${created.json.documents[0].id}`, { headers });
    await call('POST', `/v1/sign/${token}/view`, { headers });
    const fields = view.json.fields as { id: string; type: string }[];
    const values = fields.map((f) => ({
      fieldId: f.id,
      value: f.type === 'signature' ? PNG : new Date().toISOString().slice(0, 10),
    }));
    await call('POST', `/v1/sign/${token}/submit`, { headers, body: { consent: true, values } });
    const approved = await call('POST', `/v1/sign/${h.tokenFor('ravi@example.com')}/submit`, {
      body: { consent: true, values: [] },
    });
    expect(approved.json.envelopeStatus).toBe('completed');

    const docId = created.json.documents[0].id as string;
    const sealed = await call('GET', `/v1/envelopes/${id}/documents/${docId}?version=sealed`);
    expect(sealed.res.headers.get('content-type')).toBe('application/pdf');
    await call('GET', `/v1/envelopes/${id}/documents/${docId}/verification`);
    await call('GET', `/v1/envelopes/${id}/events`);
    await call('GET', `/v1/envelopes/${id}/certificate`);

    const second = await call('POST', '/v1/envelopes', {
      body: { ...body, send: true, recipients: body.recipients.slice(1, 2), fields: [] },
    });
    const declined = await call('POST', `/v1/sign/${h.tokenFor('ravi@example.com')}/decline`, {
      body: { reason: 'Wrong date' },
    });
    expect(declined.json.envelopeStatus).toBe('declined');
    const third = await call('POST', '/v1/envelopes', {
      body: { ...body, send: true, recipients: body.recipients.slice(1, 2), fields: [] },
    });
    const voided = await call('POST', `/v1/envelopes/${third.json.id}/void`, {
      body: { reason: 'Sent by mistake' },
    });
    expect(voided.json.status).toBe('voided');
    expect(second.json.status).toBe('sent');

    const form = new FormData();
    form.set(
      'envelope',
      JSON.stringify({ title: 'Upload', recipients: [{ name: 'A', email: 'a@example.com' }] }),
    );
    form.append('documents', new Blob([pdf], { type: 'application/pdf' }), 'upload.pdf');
    expect((await call('POST', '/v1/envelopes', { body: form })).status).toBe(201);

    const failures = [
      await call('GET', `/v1/envelopes/${id}`, { auth: false }),
      await call('GET', '/v1/envelopes/missing'),
      await call('PATCH', `/v1/envelopes/${id}`, { body: { title: 'Late' } }),
      await call('POST', '/v1/envelopes', { body: { ...body, recipients: [] } }),
      await call('GET', `/v1/sign/${'x'.repeat(43)}`),
    ];
    expect(failures.map((f) => f.status)).toEqual([401, 404, 409, 400, 401]);

    for (const delivery of h.deliveries) {
      const header = delivery.headers['x-codevibe-signature'];
      expect(verifyWebhook(WEBHOOK_SECRET, header, delivery.body)).toBe(true);
      const validate = validator({ $ref: '#/components/schemas/WebhookEvent' });
      expect(validate(JSON.parse(delivery.body)), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(h.deliveries.length).toBeGreaterThan(0);

    const missing = operations()
      .map((o) => o.operation.operationId)
      .filter((op) => !seen.has(op));
    expect(missing).toEqual([]);
  }, 60_000);

  it('accepts the create example as it is, so Test Request works', async () => {
    const h = harness({
      pdf: defaultPdfEngine,
      clock: { now: () => new Date() },
      sealer: { p12, passphrase: 'pass' },
    });
    const media = deref(paths['/v1/envelopes']!.post as Operation).requestBody as Json;
    const json = (media.content as Json)['application/json'] as Json;
    const example = deref(Object.values(json.examples as Json)[0]).value;
    const created = await checked(h)('POST', '/v1/envelopes', { body: example });
    expect(created.status).toBe(201);
    expect(created.json.status).toBe('sent');
  });

  it('documents the rate limit answer', async () => {
    const h = harness({ limits: { envelopesPerMinute: 0 } });
    const call = checked(h);
    const limited = await call('POST', '/v1/envelopes', { body: { title: 'x' } });
    expect(limited.status).toBe(429);
  });
});
