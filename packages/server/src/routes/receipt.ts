import { SignError, hasActed } from '@codevibe_technology/sign-core';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { pdfResponse } from '../http/body';
import { clientIp } from '../http/client';
import { enforce } from '../http/rate-limit';
import { RECEIPT_COOKIE, RECEIPT_HEADER, verifyReceipt } from '../http/session';
import type { Runtime } from '../runtime/context';
import { sealedFileKey } from '../runtime/seal';
import { DEFAULT_WORKSPACE } from '../tenancy';
import { receiptView } from '../views';

const receiptInvalid = () =>
  new SignError('TOKEN_INVALID', 'This receipt is no longer valid. Your copy was emailed to you.');

/**
 * `/v1/sign/receipt`: what a recipient can do after signing, with the receipt the submit call
 * handed back (cookie or `X-Sign-Receipt`). They can follow the envelope to completion and
 * download the sealed copy, and nothing else: the signing link itself stops working once they
 * have acted.
 */
export function receiptRoutes(rt: Runtime) {
  const app = new Hono();

  async function resolve(c: Context) {
    const now = rt.clock.now();
    await enforce(rt.limiter, `ip:${clientIp(c, rt)}`, rt.limits.ipRequestsPerMinute, 60_000, now);
    const value = c.req.header(RECEIPT_HEADER) ?? getCookie(c, RECEIPT_COOKIE);
    const claims = verifyReceipt(rt.sessionSecret, value, now);
    if (!claims) throw receiptInvalid();
    const stored = await rt.store.load(claims.envelopeId);
    const recipient = stored?.envelope.recipients.find((r) => r.id === claims.recipientId);
    if (!stored || !recipient || !hasActed(recipient)) throw receiptInvalid();
    return { ...stored, recipient };
  }

  async function sealedIds(envelopeId: string) {
    const events = await rt.store.listEvents(envelopeId);
    return new Set(
      events
        .filter((e) => e.action === 'document.sealed')
        .map((e) => String(e.data?.documentId ?? '')),
    );
  }

  app.get('/', async (c) => {
    const { envelope, recipient, workspaceId } = await resolve(c);
    return c.json(
      receiptView(
        envelope,
        recipient,
        workspaceId ?? DEFAULT_WORKSPACE,
        await sealedIds(envelope.id),
      ),
    );
  });

  app.get('/documents/:docId', async (c) => {
    const { envelope } = await resolve(c);
    const document = envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!document) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    const sealed =
      envelope.status === 'completed'
        ? await rt.files.get(sealedFileKey(envelope.id, document.id))
        : null;
    if (!sealed) throw new SignError('INVALID_STATE', 'The signed copy is not ready yet');
    return pdfResponse(c, sealed, document.name, 'sealed');
  });

  return app;
}
