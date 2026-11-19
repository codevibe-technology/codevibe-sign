import {
  SignError,
  createOtp,
  decline,
  hashToken,
  hasActed,
  isExpiredAt,
  isFinal,
  markAuthenticated,
  markViewed,
  submit,
  verifyOtp,
  type AuditContext,
  type Envelope,
  type FieldValue,
  type Recipient,
} from '@codevibe/sign-core';
import { maskEmail, maskPhone } from '@codevibe/sign-pdf';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { validation } from '../errors';
import { pdfResponse, readJson } from '../http/body';
import { clientIp, userAgent } from '../http/client';
import { idempotency } from '../http/idempotency';
import { enforce } from '../http/rate-limit';
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  SESSION_TTL_MS,
  issueSession,
  verifySession,
} from '../http/session';
import { parseJsonObject } from '../input';
import type { Runtime } from '../runtime/context';
import { mutate } from '../runtime/mutate';
import { signerView } from '../views';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const OTP_METHODS = new Set(['email_otp', 'sms_otp']);

interface SignerContext {
  tokenHash: string;
  envelope: Envelope;
  recipient: Recipient;
  otpRequired: boolean;
  authenticated: boolean;
}

const tokenInvalid = () => new SignError('TOKEN_INVALID', 'This signing link is no longer valid');

export function signerRoutes(rt: Runtime) {
  const app = new Hono();

  app.use(
    '/:token/*',
    idempotency(
      rt.store,
      (c) => `token:${hashToken(c.req.param('token') ?? '')}`,
      () => rt.clock.now(),
    ),
  );

  async function resolve(c: Context): Promise<SignerContext> {
    const now = rt.clock.now();
    const ip = clientIp(c, rt.trustProxy);
    await enforce(rt.limiter, `ip:${ip}`, rt.limits.ipRequestsPerMinute, 60_000, now);
    const tokenHash = hashToken(c.req.param('token') ?? '');
    await enforce(rt.limiter, `token:${tokenHash}`, rt.limits.signerRequestsPerMinute, 60_000, now);

    const token = await rt.store.findToken(tokenHash);
    if (!token || token.revokedAt || token.expiresAt.getTime() <= now.getTime())
      throw tokenInvalid();
    const envelope = await rt.store.get(token.envelopeId);
    const recipient = envelope?.recipients.find((r) => r.id === token.recipientId);
    if (!envelope || !recipient) throw tokenInvalid();
    if (isFinal(envelope) || hasActed(recipient) || isExpiredAt(envelope, now)) {
      throw tokenInvalid();
    }
    const otpRequired = OTP_METHODS.has(recipient.auth);
    const session = c.req.header(SESSION_HEADER) ?? getCookie(c, SESSION_COOKIE);
    const authenticated = otpRequired && verifySession(rt.sessionSecret, session, tokenHash, now);
    return { tokenHash, envelope, recipient, otpRequired, authenticated };
  }

  async function resolveForAction(c: Context): Promise<SignerContext> {
    const signer = await resolve(c);
    if (signer.otpRequired && !signer.authenticated) {
      throw new SignError('OTP_INVALID', 'Verify the one-time code first', { otpRequired: true });
    }
    return signer;
  }

  const deps = { clock: rt.clock };
  const context = (c: Context): AuditContext => {
    const ua = userAgent(c);
    return { ip: clientIp(c, rt.trustProxy), ...(ua ? { userAgent: ua } : {}) };
  };

  app.get('/:token', async (c) => {
    const signer = await resolve(c);
    return c.json(
      signerView(signer.envelope, signer.recipient, {
        required: signer.otpRequired,
        authenticated: signer.authenticated,
      }),
    );
  });

  app.get('/:token/documents/:docId', async (c) => {
    const { envelope } = await resolveForAction(c);
    const document = envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!document) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    const bytes = await rt.files.get(document.fileKey);
    if (!bytes) throw new SignError('ENVELOPE_NOT_FOUND', 'Document file not found');
    return pdfResponse(c, bytes, document.name, 'original');
  });

  app.post('/:token/otp', async (c) => {
    const { envelope, recipient, otpRequired } = await resolve(c);
    if (!otpRequired) throw validation('This signing link does not use a one-time code');
    const now = rt.clock.now();
    const sends = rt.limits.otpSendsPer15Minutes;
    await enforce(
      rt.limiter,
      `otp-send:${envelope.id}:${recipient.id}`,
      sends,
      FIFTEEN_MINUTES,
      now,
    );
    await enforce(
      rt.limiter,
      `otp-send-ip:${clientIp(c, rt.trustProxy)}`,
      sends * 4,
      FIFTEEN_MINUTES,
      now,
    );

    const issued = createOtp(rt.random, rt.clock);
    await rt.store.putOtp({
      envelopeId: envelope.id,
      recipientId: recipient.id,
      state: issued.state,
    });
    const code = issued.code;
    await rt.otp.send(recipient, code);
    const sentTo =
      recipient.auth === 'sms_otp' && recipient.phone
        ? maskPhone(recipient.phone)
        : recipient.email
          ? maskEmail(recipient.email)
          : null;
    return c.json({ sentTo, expiresAt: issued.expiresAt });
  });

  app.post('/:token/otp/verify', async (c) => {
    const signer = await resolve(c);
    const { envelope, recipient } = signer;
    if (!signer.otpRequired) throw validation('This signing link does not use a one-time code');
    const now = rt.clock.now();
    await enforce(
      rt.limiter,
      `otp-verify-ip:${clientIp(c, rt.trustProxy)}`,
      30,
      FIFTEEN_MINUTES,
      now,
    );
    const body = parseJsonObject(await readJson(c));
    const code = typeof body.code === 'string' ? body.code.trim() : '';

    const challenge = await rt.store.getOtp(envelope.id, recipient.id);
    if (!challenge) throw new SignError('OTP_EXPIRED', 'Ask for a code first.');
    const check = verifyOtp(challenge.state, code, rt.clock);
    await rt.store.putOtp({ ...challenge, state: check.state });
    if (!check.ok) throw check.error;
    await mutate(rt, envelope.id, (current) =>
      markAuthenticated(current, { recipientId: recipient.id, context: context(c) }, deps),
    );
    const session = issueSession(rt.sessionSecret, signer.tokenHash, now);
    setCookie(c, SESSION_COOKIE, session.value, {
      httpOnly: true,
      secure: c.req.url.startsWith('https:'),
      sameSite: 'Strict',
      path: '/v1/sign',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ sessionToken: session.value, expiresAt: session.expiresAt.toISOString() });
  });

  app.post('/:token/view', async (c) => {
    const { envelope, recipient } = await resolveForAction(c);
    const result = await mutate(rt, envelope.id, (current) =>
      markViewed(current, { recipientId: recipient.id, context: context(c) }, deps),
    );
    return c.json(statusOf(result.envelope, recipient));
  });

  app.post('/:token/submit', async (c) => {
    const { envelope, recipient } = await resolveForAction(c);
    if (recipient.auth === 'aadhaar') {
      throw validation('This recipient signs with Aadhaar eSign through the eSign provider');
    }
    const body = parseJsonObject(await readJson(c));
    if (body.consent !== true) {
      throw validation('consent must be true: the signer agrees to sign electronically', {
        field: 'consent',
      });
    }
    const values = parseValues(body.values);
    const result = await mutate(rt, envelope.id, (current) =>
      submit(current, { recipientId: recipient.id, values, context: context(c) }, deps),
    );
    return c.json(statusOf(result.envelope, recipient));
  });

  app.post('/:token/decline', async (c) => {
    const { envelope, recipient } = await resolveForAction(c);
    const body = parseJsonObject(await readJson(c, true));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw validation('reason is required', { field: 'reason' });
    const result = await mutate(rt, envelope.id, (current) =>
      decline(current, { recipientId: recipient.id, reason, context: context(c) }, deps),
    );
    return c.json(statusOf(result.envelope, recipient));
  });

  return app;
}

function statusOf(envelope: Envelope, recipient: Recipient) {
  const current = envelope.recipients.find((r) => r.id === recipient.id);
  return { envelopeStatus: envelope.status, recipientStatus: current?.status ?? recipient.status };
}

/** Shape only; core checks each value against its field (PNG size, dates, lengths). */
function parseValues(raw: unknown): FieldValue[] {
  if (!Array.isArray(raw) || raw.length > 500) {
    throw validation('values must be a list of { fieldId, value }', { field: 'values' });
  }
  return raw.map((item, i) => {
    const v = parseJsonObject(item, `values[${i}]`);
    if (typeof v.fieldId !== 'string' || typeof v.value !== 'string') {
      throw validation(`values[${i}] needs a fieldId and a string value`, {
        field: `values[${i}]`,
      });
    }
    return { fieldId: v.fieldId, value: v.value };
  });
}
