import type { MailMessage } from '@codevibe_technology/sign-core';
import { describe, expect, it, vi } from 'vitest';
import {
  GRAPH_MAX_ATTACHMENT_BYTES,
  GRAPH_MAX_REQUEST_BYTES,
  GraphMailError,
  graphMailer,
  graphMessage,
  parseMailbox,
} from './graph-mail';
import { loggingMailer, type MailLogEntry } from './mail-log';

const SECRET = 'sEcReT~value.0123456789';
const TOKEN_URL = 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token';
const SEND_URL = 'https://graph.microsoft.com/v1.0/users/no-reply%40codevibe.in/sendMail';

const message: MailMessage = {
  to: 'asha@example.com',
  fromName: 'Acme HR',
  replyTo: 'hr@acme.example',
  subject: 'Please sign: Offer letter',
  text: 'Open the link to sign.',
  html: '<p>Open the link to sign.</p>',
  meta: { kind: 'invite', workspaceId: 'ws_1' },
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const tokenOk = (value = 'token-1', expiresIn = 3600) =>
  json(200, { access_token: value, expires_in: expiresIn, token_type: 'Bearer' });

const accepted = () => new Response(null, { status: 202, headers: { 'request-id': 'req-1' } });

function setup(responses: (() => Response)[], clock = { t: 1_000_000 }) {
  const queue = [...responses];
  const fetch = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () => {
      const next = queue.shift();
      if (!next) throw new Error('unexpected request');
      return next();
    },
  );
  const log = vi.fn<(line: string) => void>();
  const mailer = graphMailer({
    tenantId: 'tenant-1',
    clientId: 'client-1',
    clientSecret: SECRET,
    from: 'Codevibe <no-reply@codevibe.in>',
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => clock.t,
    log,
  });
  const calls = () => fetch.mock.calls.map(([url, init]) => ({ url: String(url), init: init! }));
  return { mailer, fetch, log, calls, clock };
}

async function failure(promise: Promise<unknown>): Promise<GraphMailError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GraphMailError);
    return err as GraphMailError;
  }
  throw new Error('expected the send to fail');
}

describe('parseMailbox', () => {
  it('reads a display name and an address', () => {
    expect(parseMailbox('Codevibe <no-reply@codevibe.in>')).toEqual({
      name: 'Codevibe',
      address: 'no-reply@codevibe.in',
    });
    expect(parseMailbox(' no-reply@codevibe.in ')).toEqual({ address: 'no-reply@codevibe.in' });
    expect(parseMailbox('"Acme\r\nBcc: x" <a@b.co>')).toEqual({
      name: 'AcmeBcc: x',
      address: 'a@b.co',
    });
  });
});

describe('graphMessage', () => {
  it('maps the sender name, recipient, reply-to, subject and HTML body', () => {
    expect(graphMessage(message, 'Codevibe <no-reply@codevibe.in>')).toEqual({
      message: {
        subject: 'Please sign: Offer letter',
        body: { contentType: 'HTML', content: '<p>Open the link to sign.</p>' },
        from: { emailAddress: { address: 'no-reply@codevibe.in', name: 'Acme HR' } },
        toRecipients: [{ emailAddress: { address: 'asha@example.com' } }],
        replyTo: [{ emailAddress: { address: 'hr@acme.example' } }],
      },
      saveToSentItems: false,
    });
  });

  it('sends plain text when there is no HTML and keeps the configured name by default', () => {
    const body = graphMessage(
      { to: 'a@b.co', subject: 'Code', text: 'Your code is 123456' },
      'Codevibe <no-reply@codevibe.in>',
    );
    expect(body.message.body).toEqual({ contentType: 'Text', content: 'Your code is 123456' });
    expect(body.message.from.emailAddress).toEqual({
      address: 'no-reply@codevibe.in',
      name: 'Codevibe',
    });
    expect(body.message).not.toHaveProperty('replyTo');
    expect(body.message).not.toHaveProperty('attachments');
  });

  it('encodes attachments as base64 file attachments and never sends meta', () => {
    const content = new TextEncoder().encode('%PDF-1.7 sealed');
    const body = graphMessage(
      {
        ...message,
        attachments: [{ filename: 'Offer.pdf', content, contentType: 'application/pdf' }],
      },
      'no-reply@codevibe.in',
    );
    expect(body.message.attachments).toEqual([
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'Offer.pdf',
        contentType: 'application/pdf',
        contentBytes: Buffer.from('%PDF-1.7 sealed').toString('base64'),
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('ws_1');
  });
});

describe('graphMailer', () => {
  it('gets a client-credentials token and posts the message to sendMail', async () => {
    const { mailer, calls } = setup([() => tokenOk(), accepted]);
    expect(await mailer.send(message)).toEqual({ messageId: 'req-1' });

    const [token, send] = calls();
    expect(token!.url).toBe(TOKEN_URL);
    expect(token!.init.method).toBe('POST');
    const form = new URLSearchParams(String(token!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-1',
      client_secret: SECRET,
      scope: 'https://graph.microsoft.com/.default',
    });

    expect(send!.url).toBe(SEND_URL);
    expect(send!.init.method).toBe('POST');
    const headers = send!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-1');
    expect(headers['content-type']).toBe('application/json');
    expect(headers['client-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(send!.init.body))).toEqual(
      graphMessage(message, 'Codevibe <no-reply@codevibe.in>'),
    );
  });

  it('falls back to its own request id when Graph sends none', async () => {
    const { mailer, calls } = setup([() => tokenOk(), () => new Response(null, { status: 202 })]);
    const receipt = await mailer.send(message);
    const sent = calls()[1]!.init.headers as Record<string, string>;
    expect(receipt).toEqual({ messageId: sent['client-request-id'] });
  });

  it('reuses the token until five minutes before it expires', async () => {
    const clock = { t: 0 };
    const { mailer, calls } = setup(
      [() => tokenOk('token-1', 3600), accepted, accepted, () => tokenOk('token-2'), accepted],
      clock,
    );
    await mailer.send(message);
    clock.t = (3600 - 5 * 60 - 1) * 1000;
    await mailer.send(message);
    clock.t = (3600 - 5 * 60) * 1000;
    await mailer.send(message);

    const urls = calls().map((c) => c.url);
    expect(urls).toEqual([TOKEN_URL, SEND_URL, SEND_URL, TOKEN_URL, SEND_URL]);
    const bearer = (i: number) =>
      (calls()[i]!.init.headers as Record<string, string>).authorization;
    expect([bearer(1), bearer(2), bearer(4)]).toEqual([
      'Bearer token-1',
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('asks for one token when several emails go out at once', async () => {
    const { mailer, calls } = setup([() => tokenOk(), accepted, accepted]);
    await Promise.all([mailer.send(message), mailer.send(message)]);
    expect(calls().filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('renews the token once when Graph answers 401', async () => {
    const { mailer, calls } = setup([
      () => tokenOk('stale'),
      () => json(401, { error: { code: 'InvalidAuthenticationToken' } }),
      () => tokenOk('fresh'),
      accepted,
    ]);
    expect(await mailer.send(message)).toEqual({ messageId: 'req-1' });
    const sends = calls().filter((c) => c.url === SEND_URL);
    expect(sends.map((c) => (c.init.headers as Record<string, string>).authorization)).toEqual([
      'Bearer stale',
      'Bearer fresh',
    ]);
  });

  it('gives up after a second 401', async () => {
    const unauthorized = () => json(401, { error: { code: 'InvalidAuthenticationToken' } });
    const { mailer, calls } = setup([() => tokenOk(), unauthorized, () => tokenOk(), unauthorized]);
    const err = await failure(mailer.send(message));
    expect(err.code).toBe('access_denied');
    expect(err.message).toContain('Mail.Send');
    expect(calls()).toHaveLength(4);
  });

  it('refuses a message over the Graph size limit before calling Microsoft', async () => {
    const big = new Uint8Array(Math.ceil((GRAPH_MAX_REQUEST_BYTES * 3) / 4) + 1);
    const { mailer, fetch, log } = setup([]);
    const err = await failure(
      mailer.send({
        ...message,
        attachments: [{ filename: 'big.pdf', content: big, contentType: 'application/pdf' }],
      }),
    );
    expect(err.code).toBe('too_large');
    expect(err.message).toMatch(/send links instead/);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('send links instead'));
  });

  it('sends attachments up to the completed-copy limit inline', async () => {
    const pdf = new Uint8Array(GRAPH_MAX_ATTACHMENT_BYTES);
    const { mailer, calls } = setup([() => tokenOk(), accepted]);
    await mailer.send({
      ...message,
      attachments: [{ filename: 'a.pdf', content: pdf, contentType: 'application/pdf' }],
    });
    expect(Buffer.byteLength(String(calls()[1]!.init.body))).toBeLessThan(GRAPH_MAX_REQUEST_BYTES);
  });

  describe('token errors', () => {
    const cases: [string, number, Record<string, unknown>, string, RegExp][] = [
      [
        'a wrong secret',
        401,
        {
          error: 'invalid_client',
          error_description: 'AADSTS7000215: Invalid client secret provided.',
          error_codes: [7000215],
        },
        'bad_secret',
        /MS_CLIENT_SECRET.*Certificates & secrets/,
      ],
      [
        'an expired secret',
        401,
        {
          error: 'invalid_client',
          error_description: 'AADSTS7000222: The provided client secret keys are expired.',
        },
        'bad_secret',
        /expired.*AADSTS7000222.*new client secret/,
      ],
      [
        'an unknown client id',
        400,
        { error: 'unauthorized_client', error_codes: [700016] },
        'bad_ids',
        /MS_CLIENT_ID.*MS_TENANT_ID/,
      ],
      [
        'an unknown tenant',
        400,
        { error: 'invalid_request', error_codes: [90002] },
        'bad_ids',
        /AADSTS90002/,
      ],
      [
        'anything else',
        400,
        { error: 'invalid_scope', error_codes: [70011] },
        'token_failed',
        /invalid_scope.*AADSTS70011/,
      ],
    ];

    it.each(cases)('explains %s', async (_name, status, body, code, text) => {
      const { mailer, log } = setup([() => json(status, body)]);
      const err = await failure(mailer.send(message));
      expect(err.code).toBe(code);
      expect(err.message).toMatch(text);
      expect(log).toHaveBeenCalledWith(`[mail] Microsoft Graph: ${err.message}`);
    });

    it('treats a busy sign-in service as transient', async () => {
      const { mailer } = setup([() => json(503, {})]);
      const err = await failure(mailer.send(message));
      expect(err.code).toBe('unavailable');
      expect(err.transient).toBe(true);
    });
  });

  describe('send errors', () => {
    const cases: [string, number, Record<string, unknown>, string, RegExp][] = [
      [
        'a missing permission',
        403,
        { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } },
        'access_denied',
        /Mail\.Send application permission.*admin consent.*no-reply@codevibe\.in/,
      ],
      [
        'an unknown mailbox',
        404,
        { error: { code: 'ErrorInvalidUser', message: 'The requested user is invalid.' } },
        'unknown_mailbox',
        /no mailbox no-reply@codevibe\.in.*MAIL_FROM/,
      ],
      [
        'an invalid user on another status',
        400,
        { error: { code: 'ErrorInvalidUser' } },
        'unknown_mailbox',
        /ErrorInvalidUser/,
      ],
      [
        'an oversized message',
        413,
        { error: { code: 'ErrorMessageSizeExceeded' } },
        'too_large',
        /too large/,
      ],
      ['a throttled send', 429, {}, 'unavailable', /busy \(HTTP 429, asked to wait 7s\)/],
      ['an unavailable service', 503, {}, 'unavailable', /tried again/],
      [
        'anything else',
        400,
        { error: { code: 'ErrorInvalidRecipients' } },
        'send_failed',
        /ErrorInvalidRecipients/,
      ],
    ];

    it.each(cases)('explains %s', async (_name, status, body, code, text) => {
      const { mailer, log } = setup([
        () => tokenOk(),
        () => json(status, body, status === 429 ? { 'retry-after': '7' } : {}),
      ]);
      const err = await failure(mailer.send(message));
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
      expect(err.message).toMatch(text);
      expect(err.transient).toBe(code === 'unavailable');
      expect(log).toHaveBeenCalledWith(`[mail] Microsoft Graph: ${err.message}`);
    });

    it('treats a network failure as transient', async () => {
      const { mailer } = setup([
        () => tokenOk(),
        () => {
          throw new TypeError('fetch failed');
        },
      ]);
      const err = await failure(mailer.send(message));
      expect(err.code).toBe('unavailable');
      expect(err.message).toContain('TypeError');
    });
  });

  it('never puts the client secret in an error or a log line', async () => {
    const echo = () =>
      json(401, {
        error: 'invalid_client',
        error_description: `AADSTS7000215: Invalid client secret provided: ${SECRET}`,
        error_codes: [7000215],
      });
    const scenarios: (() => Response)[][] = [
      [echo],
      [() => json(400, { error: SECRET })],
      [() => tokenOk(), () => json(403, { error: { code: SECRET } })],
      [() => tokenOk(), () => json(500, { error: { code: `x${SECRET}x` } })],
    ];
    for (const responses of scenarios) {
      const { mailer, log } = setup(responses);
      const err = await failure(mailer.send(message));
      expect(err.message).not.toContain(SECRET);
      expect(String(err.stack)).not.toContain(SECRET);
      for (const [line] of log.mock.calls) expect(line).not.toContain(SECRET);
    }
  });

  it('records the actionable reason in the mail log, whole and without the secret', async () => {
    const { mailer } = setup([
      () =>
        json(401, {
          error: 'invalid_client',
          error_description: `AADSTS7000222: expired ${SECRET}`,
          error_codes: [7000222],
        }),
    ]);
    const entries: MailLogEntry[] = [];
    const logged = loggingMailer(mailer, async (entry) => void entries.push(entry));
    await expect(logged.send(message)).rejects.toBeInstanceOf(GraphMailError);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('failed');
    expect(entries[0]!.error).toMatch(/MS_CLIENT_SECRET.*Certificates & secrets.*its value\.$/);
    expect(entries[0]!.error).not.toContain(SECRET);
  });
});
