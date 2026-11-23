import { SignError } from '@codevibe_technology/sign-core';
import { Hono } from 'hono';
import { pdfResponse } from '../http/body';
import { clientIp } from '../http/client';
import { enforce } from '../http/rate-limit';
import { verifyCopyClaim } from '../http/session';
import { auditTrailFile } from '../runtime/audit-trail';
import type { Runtime } from '../runtime/context';
import { certificateFileKey, sealedFileKey } from '../runtime/seal';

const linkInvalid = () =>
  new SignError(
    'TOKEN_INVALID',
    'This download link is no longer valid. Ask the sender for a copy.',
  );

/**
 * `/v1/sign/copy/:docId?c=...`: the download link in a completed-copy email whose files were
 * not attached; `&file=certificate` or `&file=audit-trail` picks the other files. The signed `c` value names the envelope and recipient; it works only for a
 * completed envelope that recipient is on.
 */
export function copyRoutes(rt: Runtime) {
  const app = new Hono();

  app.get('/:docId', async (c) => {
    const now = rt.clock.now();
    await enforce(rt.limiter, `ip:${clientIp(c, rt)}`, rt.limits.ipRequestsPerMinute, 60_000, now);
    const claims = verifyCopyClaim(rt.sessionSecret, c.req.query('c'), now);
    if (!claims) throw linkInvalid();
    const stored = await rt.store.load(claims.envelopeId);
    const envelope = stored?.envelope;
    if (!envelope || !envelope.recipients.some((r) => r.id === claims.recipientId)) {
      throw linkInvalid();
    }
    if (envelope.status !== 'completed') throw linkInvalid();
    const document = envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!document) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    const file = c.req.query('file');
    if (file === 'audit-trail') {
      const trail = await auditTrailFile(rt, envelope, stored?.workspaceId);
      if (!trail) throw new SignError('INVALID_STATE', 'This server cannot draw an audit trail');
      return pdfResponse(c, trail, envelope.title, 'audit-trail');
    }
    const certificate = file === 'certificate';
    const key = certificate ? certificateFileKey : sealedFileKey;
    const sealed = await rt.files.get(key(envelope.id, document.id));
    if (!sealed) throw new SignError('INVALID_STATE', 'The signed copy is not ready yet');
    return pdfResponse(c, sealed, document.name, certificate ? 'certificate' : 'sealed');
  });

  return app;
}
