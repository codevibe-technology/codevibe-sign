import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultPdfEngine } from '../../src/engine';
import { API_KEY, harness, PNG, WEBHOOK_SECRET } from '../../src/testing/harness';
import { makeP12, makePdf } from '../../src/testing/real-pdf';
import { API_VERSION, deprecatedOperations } from '../../src/http/versioning';
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

  it('keeps every route of the API under /v1', () => {
    // The two exceptions are not API calls: a probe for load balancers, and the address
    // printed in every signing email, which has to stay the same for as long as links live.
    const unversioned = ['/health', '/sign/{token}'];
    const outside = Object.keys(paths).filter((path) => !path.startsWith('/v1/'));
    expect(outside.sort()).toEqual(unversioned);
    expect(spec.info.version).toBe(API_VERSION);
  });

  it('gives every deprecated operation both dates, six months apart or more', () => {
    for (const { operation, method, path } of operations()) {
      const marked = operation as unknown as Json;
      if (!marked.deprecated) {
        expect(marked['x-sunset'], `${method} ${path}`).toBeUndefined();
        expect(marked['x-deprecated-since'], `${method} ${path}`).toBeUndefined();
      }
    }
    expect(() => deprecatedOperations(spec)).not.toThrow();
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

  it('describes every error code in a sentence', () => {
    const codes = spec.components.schemas.ErrorCode;
    const descriptions = codes['x-descriptions'] as Record<string, string>;
    expect(Object.keys(descriptions).sort()).toEqual([...codes.enum].sort());
    for (const code of codes.enum) expect(descriptions[code], code).toMatch(/^[A-Z].*\.$/);
  });

  it('has response examples that match their schemas', () => {
    for (const { operation } of operations()) {
      for (const [status, raw] of Object.entries(operation.responses)) {
        const json = (deref(raw).content as Json | undefined)?.['application/json'] as
          | Json
          | undefined;
        if (!json?.schema) continue;
        const examples = [
          ...(json.example !== undefined ? [json.example] : []),
          ...Object.values((json.examples ?? {}) as Json).map((e) => deref(e).value),
        ];
        const validate = validator(json.schema as Json);
        for (const example of examples) {
          expect(
            validate(example),
            `${operation.operationId} ${status}: ${JSON.stringify(validate.errors)}`,
          ).toBe(true);
        }
      }
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
        {
          key: 'ravi',
          name: 'Ravi Kumar',
          email: 'ravi@example.com',
          role: 'approver',
          auth: 'email_link',
        },
        { key: 'hr', name: 'HR', email: 'hr@example.com', role: 'viewer', auth: 'email_link' },
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
    const notDue = await call('POST', `/v1/envelopes/${id}/remind`);
    expect(notDue.json.error.code).toBe('INVALID_STATE');

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
    const signed = await call('POST', `/v1/sign/${token}/submit`, {
      headers,
      body: { consent: true, values },
    });
    const receipt = { 'x-sign-receipt': signed.res.headers.get('x-sign-receipt')! };
    const docId = created.json.documents[0].id as string;
    const waiting = await call('GET', '/v1/sign/receipt', { headers: receipt });
    expect(waiting.json.waitingFor).toBe(1);
    const early = await call('GET', `/v1/sign/receipt/documents/${docId}`, { headers: receipt });
    expect(early.json.error.code).toBe('INVALID_STATE');
    const approved = await call('POST', `/v1/sign/${h.tokenFor('ravi@example.com')}/submit`, {
      body: { consent: true, values: [] },
    });
    expect(approved.json.envelopeStatus).toBe('completed');
    const copy = await call('GET', `/v1/sign/receipt/documents/${docId}`, { headers: receipt });
    expect(copy.res.headers.get('content-type')).toBe('application/pdf');

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

    const fourth = await call('POST', '/v1/envelopes', {
      body: { ...body, send: true, recipients: body.recipients.slice(1, 2), fields: [] },
    });
    const ravi = fourth.json.recipients[0].id as string;
    const shared = await call('POST', `/v1/envelopes/${fourth.json.id}/recipients/${ravi}/link`);
    expect(shared.status).toBe(201);
    const corrected = await call('PATCH', `/v1/envelopes/${fourth.json.id}/recipients/${ravi}`, {
      body: { name: 'Ravi K.' },
    });
    expect(corrected.json.recipients[0].name).toBe('Ravi K.');
    const recalled = await call('POST', `/v1/envelopes/${fourth.json.id}/recall`, {
      body: { note: 'Wrong file' },
    });
    expect(recalled.status).toBe(201);
    const replaced = await call(
      'PUT',
      `/v1/envelopes/${recalled.json.draft.id}/documents/${recalled.json.draft.documents[0].id}`,
      { body: { name: 'v2.pdf', content: Buffer.from(pdf).toString('base64') } },
    );
    expect(replaced.status).toBe(200);
    const revised = await call('POST', `/v1/envelopes/${second.json.id}/revise`);
    expect(revised.status).toBe(201);

    const form = new FormData();
    form.set(
      'envelope',
      JSON.stringify({ title: 'Upload', recipients: [{ name: 'A', email: 'a@example.com' }] }),
    );
    form.append('documents', new Blob([pdf], { type: 'application/pdf' }), 'upload.pdf');
    expect((await call('POST', '/v1/envelopes', { body: form })).status).toBe(201);

    const templateBody = {
      name: 'Offer letter',
      description: 'Standard offer for full-time staff',
      documents: [{ key: 'offer', name: 'offer.pdf', content }],
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
        },
      ],
    };
    const template = await call('POST', '/v1/templates', {
      body: templateBody,
      headers: { 'idempotency-key': 'template-1' },
    });
    expect(template.status).toBe(201);
    const templateId = template.json.id as string;
    const templates = await call('GET', '/v1/templates?limit=1&q=offer');
    expect(templates.json.templates[0].id).toBe(templateId);
    await call('GET', `/v1/templates/${templateId}`);
    const renamed = await call('PATCH', `/v1/templates/${templateId}`, {
      body: { name: 'Offer letter 2026', description: null },
    });
    expect(renamed.json.name).toBe('Offer letter 2026');
    const fromTemplate = await call('POST', `/v1/templates/${templateId}/envelopes`, {
      body: {
        roles: {
          Employee: { name: 'Meera Nair', email: 'meera@example.com' },
          HR: { name: 'HR', email: 'hr@example.com' },
        },
        prefill: { 'Employee code': 'E-1042' },
        send: true,
      },
    });
    expect(fromTemplate.status).toBe(201);
    expect(fromTemplate.json.metadata.templateId).toBe(templateId);
    expect(fromTemplate.json.values).toHaveLength(1);
    const noPerson = await call('POST', `/v1/templates/${templateId}/envelopes`, {
      body: { roles: {} },
    });
    expect(noPerson.status).toBe(400);
    const uploadTemplate = new FormData();
    uploadTemplate.set('template', JSON.stringify({ name: 'Upload', roles: [{ name: 'Signer' }] }));
    uploadTemplate.append('documents', new Blob([pdf], { type: 'application/pdf' }), 'upload.pdf');
    expect((await call('POST', '/v1/templates', { body: uploadTemplate })).status).toBe(201);
    expect((await call('DELETE', `/v1/templates/${templateId}`)).json.deleted).toBe(true);
    expect((await call('GET', `/v1/templates/${templateId}`)).status).toBe(404);
    expect((await call('DELETE', `/v1/templates/${templateId}`)).status).toBe(404);
    expect((await call('GET', '/v1/templates', { auth: false })).status).toBe(401);

    const sealedBytes = new Uint8Array(
      await (
        await h.server.app.request(`/v1/envelopes/${id}/documents/${docId}?version=sealed`, {
          headers: { authorization: `Bearer ${API_KEY}` },
        })
      ).arrayBuffer(),
    );
    const sealedForm = new FormData();
    sealedForm.set('file', new Blob([sealedBytes], { type: 'application/pdf' }), 'sealed.pdf');
    const verified = await call('POST', '/v1/verify', { body: sealedForm, auth: false });
    expect(verified.json).toMatchObject({ valid: true, envelope: { id, documentId: docId } });
    const sealedHash = verified.json.sha256 as string;
    const byHash = await call('GET', `/v1/verify/${sealedHash}`, { auth: false });
    expect(byHash.json).toEqual(verified.json);
    const tampered = new Uint8Array(sealedBytes);
    tampered[tampered.length - 200] = tampered[tampered.length - 200]! ^ 1;
    const tamperedForm = new FormData();
    tamperedForm.set('file', new Blob([tampered], { type: 'application/pdf' }), 'sealed.pdf');
    const broken = await call('POST', '/v1/verify', { body: tamperedForm });
    expect(broken.json).toMatchObject({ valid: false, envelope: null });
    const unsealedForm = new FormData();
    unsealedForm.set('file', new Blob([pdf], { type: 'application/pdf' }), 'plain.pdf');
    const unsealed = await call('POST', '/v1/verify', { body: unsealedForm });
    expect(unsealed.json).toMatchObject({ valid: false, reason: 'not_sealed' });
    expect((await call('GET', `/v1/verify/${'0'.repeat(64)}`)).json.reason).toBe(
      'unknown_document',
    );
    expect((await call('GET', '/v1/verify/not-a-hash')).status).toBe(400);
    const notPdf = new FormData();
    notPdf.set('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    expect((await call('POST', '/v1/verify', { body: notPdf })).status).toBe(422);
    expect((await call('POST', '/v1/verify', { body: { sha256: sealedHash } })).status).toBe(400);

    const failures = [
      await call('GET', `/v1/envelopes/${id}`, { auth: false }),
      await call('GET', '/v1/envelopes/missing'),
      await call('PATCH', `/v1/envelopes/${id}`, { body: { title: 'Late' } }),
      await call('POST', '/v1/envelopes', { body: { ...body, recipients: [] } }),
      await call('GET', `/v1/sign/${'x'.repeat(43)}`),
      await call('GET', '/v1/sign/receipt', { headers: { 'x-sign-receipt': 'forged.receipt' } }),
      await call('GET', `/v1/sign/copy/${docId}?c=forged.claim`),
    ];
    expect(failures.map((f) => f.status)).toEqual([401, 404, 409, 400, 401, 401, 401]);

    for (const delivery of h.deliveries) {
      const header = delivery.headers['x-codevibe-signature'];
      expect(verifyWebhook(WEBHOOK_SECRET, header, delivery.body)).toBe(true);
      const validate = validator({ $ref: '#/components/schemas/WebhookEvent' });
      expect(validate(JSON.parse(delivery.body)), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(h.deliveries.length).toBeGreaterThan(0);

    const test = await h.server.sendTestWebhook({
      workspaceId: 'default',
      url: 'https://hooks.example.com/sign',
    });
    expect(test.outcome).toBe('delivered');
    const validateTest = validator({ $ref: '#/components/schemas/WebhookTestEvent' });
    const testBody = JSON.parse(h.deliveries.at(-1)!.body);
    expect(validateTest(testBody), JSON.stringify(validateTest.errors)).toBe(true);

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
    expect((await call('POST', '/v1/templates', { body: { name: 'x' } })).status).toBe(429);
    const busy = harness({
      limits: { verifyPer10Minutes: 0, verifySharedPer10Minutes: 0 },
    });
    const refused = await checked(busy)('GET', `/v1/verify/${'0'.repeat(64)}`);
    expect(refused.status).toBe(429);
    const form = new FormData();
    form.set('file', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'a.pdf');
    expect((await checked(busy)('POST', '/v1/verify', { body: form })).status).toBe(429);
  });
});
