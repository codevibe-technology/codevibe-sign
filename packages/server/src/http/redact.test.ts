import { describe, expect, it } from 'vitest';
import { harness, envelopeBody, API_KEY } from '../testing/harness';
import { redactMeta, redactPath, redactingLogger } from './redact';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

describe('redaction', () => {
  it('replaces the token segment and drops the query string', () => {
    expect(redactPath(`/v1/sign/${TOKEN}/otp/verify?x=1`)).toBe('/v1/sign/:token/otp/verify');
    expect(redactPath(`/sign/${TOKEN}`)).toBe('/sign/:token');
    expect(redactPath('/v1/envelopes/env_1?version=sealed')).toBe('/v1/envelopes/env_1');
  });

  it('drops secret fields and scrubs tokens and bearer keys from text', () => {
    const meta = redactMeta({
      authorization: `Bearer ${API_KEY}`,
      headers: { cookie: 'cvsign_session=abc', 'user-agent': 'curl' },
      body: '{"code":"123456"}',
      code: '123456',
      error: `GET https://sign.example.com/sign/${TOKEN} failed; Bearer ${API_KEY}`,
      envelope: 'env_1',
    });
    const text = JSON.stringify(meta);
    for (const secret of [TOKEN, API_KEY, '123456', 'cvsign_session=abc']) {
      expect(text).not.toContain(secret);
    }
    expect(meta).toMatchObject({ envelope: 'env_1', headers: { 'user-agent': 'curl' } });
  });

  it('applies to messages too', () => {
    const lines: string[] = [];
    const logger = redactingLogger({
      error: (message) => lines.push(message),
      warn: (message) => lines.push(message),
    });
    logger.error(`token ${TOKEN} rejected`);
    expect(lines).toEqual(['token [token] rejected']);
  });
});

describe('server logs', () => {
  it('never carry tokens, codes, keys or bodies, even with the access log on', async () => {
    const h = harness({ accessLog: true });
    await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({
        send: true,
        recipients: [
          { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
          { key: 'ravi', name: 'Ravi Kumar', email: 'ravi@example.com', auth: 'email_link' },
        ],
      }),
    });
    const token = h.tokenFor('asha@example.com');
    await h.call('POST', `/v1/sign/${token}/otp`);
    const code = h.otp.sent.at(-1)!.code;
    await h.call('POST', `/v1/sign/${token}/otp/verify?debug=${token}`, { body: { code } });
    await h.call('GET', `/v1/sign/${token}`, { headers: { cookie: 'cvsign_session=secret' } });

    const access = h.logs.filter((line) => line.level === 'info');
    expect(access.length).toBeGreaterThanOrEqual(4);
    expect(access.map((line) => line.meta?.path)).toContain('/v1/sign/:token/otp/verify');
    const text = JSON.stringify(h.logs);
    for (const secret of [token, code, API_KEY, 'debug=', 'cvsign_session=secret']) {
      expect(text).not.toContain(secret);
    }
  });

  it('do not quote the message when an OTP cannot be sent', async () => {
    const h = harness({
      otp: {
        send: async (_recipient, code) => {
          throw new Error(`SMS gateway refused "Your code is ${code}"`);
        },
      },
    });
    await h.call('POST', '/v1/envelopes', {
      body: envelopeBody({
        send: true,
        recipients: [{ key: 'asha', name: 'Asha', email: 'asha@example.com', auth: 'email_otp' }],
        fields: [
          { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
        ],
      }),
    });
    const res = await h.call('POST', `/v1/sign/${h.tokenFor('asha@example.com')}/otp`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(h.logs)).not.toContain('Your code is');
    expect(JSON.stringify(res.json)).not.toContain('Your code is');
  });
});
