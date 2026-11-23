import type { Envelope } from '@codevibe_technology/sign-core';
import {
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  memoryStore,
  type Principal,
  type SignServer,
} from '@codevibe_technology/sign-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FIELDS, SAMPLE_TITLE } from '@/lib/sample-envelope';
import { makeP12 } from './fixtures';

vi.mock('@/server/env', () => ({ env: () => ({ APP_URL: 'http://localhost:3000' }) }));
vi.mock('@/server/db', () => ({ db: () => ({}) }));

const { createSampleEnvelope } = await import('@/server/sample-envelope');
const { inProcess } = await import('@/server/sign/principal');
const { signRequest } = await import('@/server/sign/client');

const APP_URL = 'http://localhost:3000';
const user = { id: 'u_asha', name: 'Asha Rao', email: 'Asha@Acme.test' };

describe('the first-run sample envelope', () => {
  let sign: SignServer;
  const mail: { to: string; subject: string }[] = [];
  const recorded: unknown[] = [];
  const firstRun: unknown[][] = [];
  const sql = Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    firstRun.push([strings.join('?'), ...values]);
    return [];
  }, {});

  const request = (principal: Principal, path: `/v1/${string}`, init: RequestInit = {}) =>
    signRequest(principal, path, init);

  beforeAll(() => {
    sign = createSignServer({
      store: memoryStore(),
      files: memoryFileStore(),
      mailer: { send: async (message) => void mail.push(message) },
      otp: consoleOtpSender({ silent: true }),
      sealer: { p12: makeP12('pass'), passphrase: 'pass' },
      apiKeys: [],
      authenticate: async (req) => inProcess.get(req) ?? null,
      basePath: '/api',
      publicUrl: APP_URL,
      signingPageUrl: `${APP_URL}/sign`,
      effects: 'await',
    });
    (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign = sign;
  });

  afterAll(() => {
    delete (globalThis as unknown as { __cvsSign?: SignServer }).__cvsSign;
  });

  it('creates a draft with our PDF, the user as signer and two fields, ready to send', async () => {
    const id = await createSampleEnvelope(
      {
        sql: sql as never,
        request,
        recordSender: async (input) => void recorded.push(input),
      },
      { workspaceId: 'ws_1', user },
    );
    const principal = { id: `user:${user.id}`, workspaceId: 'ws_1' };
    const draft = (await (await request(principal, `/v1/envelopes/${id}`)).json()) as Envelope;
    expect(draft.status).toBe('draft');
    expect(draft.title).toBe(SAMPLE_TITLE);
    expect(draft.documents).toHaveLength(1);
    expect(draft.documents[0]!.pageCount).toBe(1);
    expect(draft.recipients).toEqual([
      expect.objectContaining({ name: 'Asha Rao', email: 'asha@acme.test', role: 'signer' }),
    ]);
    expect(draft.fields.map((f) => f.type)).toEqual(SAMPLE_FIELDS.map((f) => f.type));
    expect(draft.fields.every((f) => f.recipientId === draft.recipients[0]!.id)).toBe(true);
    expect(recorded).toEqual([{ workspaceId: 'ws_1', envelopeId: id, userId: user.id }]);
    expect(firstRun[0]?.slice(1)).toEqual(['ws_1', id]);

    const sent = await request(principal, `/v1/envelopes/${id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(sent.status).toBe(200);
    expect(((await sent.json()) as Envelope).status).toBe('sent');
    expect(mail.map((m) => m.to)).toContain('asha@acme.test');
  });

  it('names the signer by their name, and by their email address only without one', async () => {
    const { sampleEnvelopeBody } = await import('@/server/sample-envelope');
    expect(sampleEnvelopeBody({ name: ' ', email: 'ravi@acme.test' }).recipients[0]!.name).toBe(
      'ravi@acme.test',
    );
    expect(
      sampleEnvelopeBody({ name: ' Ravi Kumar ', email: 'ravi@acme.test' }).recipients[0]!.name,
    ).toBe('Ravi Kumar');
  });
});
