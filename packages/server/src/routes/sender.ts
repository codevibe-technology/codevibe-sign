import {
  SignError,
  dropAadhaarSignatureFields,
  remind,
  send,
  updateEnvelope,
  verifyChain,
  voidEnvelope,
  type Envelope,
  type EnvelopeStatus,
  type Id,
} from '@codevibe_technology/sign-core';
import { Hono, type Context } from 'hono';
import { sha256Hex } from '../crypto';
import { earlier, recordedAsIs } from '../verification';
import { applyParties } from '../draft';
import { VersionConflictError, validation } from '../errors';
import { pdfResponse, readJson } from '../http/body';
import { idempotency } from '../http/idempotency';
import { enforce } from '../http/rate-limit';
import { parseFields, parseJsonObject, parseRecipients, parseSettings } from '../input';
import type { Runtime } from '../runtime/context';
import type { EnvelopeListQuery } from '../store/types';
import {
  auditTrailFile,
  certificateWithAuditTrailName,
  providerAuditTrailFile,
} from '../runtime/audit-trail';
import { mutate } from '../runtime/mutate';
import { certificateFileKey, certificatesWithAuditTrail, sealedFileKey } from '../runtime/seal';
import { assertEsignReady } from '../esign/flow';
import { revisionRoutes } from './revisions';
import { createEnvelopeFromParts } from './create';
import { checkPdf, loadScoped, readUploadBody, senderAuth, type SenderEnv } from './shared';
import { principalScope } from '../tenancy';
import { apiEnvelope, certificateView, envelopeSummary } from '../views';

const STATUSES: readonly EnvelopeStatus[] = [
  'draft',
  'sent',
  'in_progress',
  'completed',
  'declined',
  'expired',
  'voided',
];

export function senderRoutes(rt: Runtime) {
  const app = new Hono<SenderEnv>();
  const deps = { clock: rt.clock, ids: rt.ids };

  app.use('*', senderAuth(rt));
  app.use(
    '*',
    idempotency(
      rt.store,
      (c) => principalScope(c.get('principal')),
      () => rt.clock.now(),
      // The answer holds a signing link, which is never stored; a retry gets a new one.
      (c) => /\/recipients\/[^/]+\/link\/?$/.test(c.req.path),
    ),
  );
  const scopeOf = (c: Context<SenderEnv>) => ({ workspaceId: c.get('principal').workspaceId });

  app.get('/', async (c) => {
    if (!rt.store.list) throw new SignError('INVALID_STATE', 'This store cannot list envelopes');
    const query = parseListQuery(c.req.query());
    const page = await rt.store.list(c.get('principal').workspaceId, query);
    return c.json({ envelopes: page.envelopes.map(envelopeSummary), nextCursor: page.nextCursor });
  });

  app.post('/', async (c) => {
    const now = rt.clock.now();
    const principal = c.get('principal');
    await enforce(
      rt.limiter,
      `envelopes:${principalScope(principal)}`,
      rt.limits.envelopesPerMinute,
      60_000,
      now,
    );
    const { body, documents } = await readUploadBody(c, rt, 'envelope');
    if (new Set(documents.map((d) => d.key)).size !== documents.length) {
      throw validation('documents must have unique keys');
    }
    if (body.send !== undefined && typeof body.send !== 'boolean') {
      throw validation('send must be true or false', { field: 'send' });
    }
    const settings = parseSettings(body, now, true);
    const recipients = parseRecipients(body, []);
    const fields = parseFields(body);
    const infos = await Promise.all(documents.map((d) => checkPdf(rt, d)));
    const envelope = await createEnvelopeFromParts(rt, principal.workspaceId, {
      settings,
      recipients,
      fields,
      documents: documents.map((upload, i) => ({ upload, info: infos[i]! })),
      send: body.send === true,
    });
    return c.json(apiEnvelope(envelope), 201);
  });

  app.get('/:id', async (c) =>
    c.json(apiEnvelope(await getEnvelope(rt, c.req.param('id'), scopeOf(c)))),
  );

  app.patch('/:id', async (c) => {
    const body = parseJsonObject(await readJson(c));
    if (body.documents !== undefined) {
      throw validation('Documents cannot be changed; create a new envelope instead', {
        field: 'documents',
      });
    }
    // Another request may save between our read and write; the draft is then re-read and the
    // change applied once more on top of it.
    for (let attempt = 1; ; attempt++) {
      const stored = await loadScoped(rt, c.req.param('id'), scopeOf(c));
      const next = applyDraftChange(rt, stored.envelope, body);
      try {
        await rt.store.commit(next, [], stored.version, []);
      } catch (err) {
        if (err instanceof VersionConflictError && attempt < 2) continue;
        throw err;
      }
      return c.json(apiEnvelope(next));
    }
  });

  app.post('/:id/send', async (c) => {
    const { envelope } = await mutate(
      rt,
      c.req.param('id'),
      async (current) => {
        const sent = send(dropAadhaarSignatureFields(current), deps);
        await assertEsignReady(rt, scopeOf(c).workspaceId, current);
        return sent;
      },
      scopeOf(c),
    );
    return c.json(apiEnvelope(envelope));
  });

  app.post('/:id/void', async (c) => {
    const body = parseJsonObject(await readJson(c, true));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw validation('reason is required', { field: 'reason' });
    const { envelope } = await mutate(
      rt,
      c.req.param('id'),
      (current) => voidEnvelope(current, { reason }, deps),
      scopeOf(c),
    );
    return c.json(apiEnvelope(envelope));
  });

  app.post('/:id/remind', async (c) => {
    const body = parseJsonObject(await readJson(c, true));
    const recipientId = body.recipientId;
    if (recipientId !== undefined && (typeof recipientId !== 'string' || !recipientId)) {
      throw validation('recipientId must be the id of a recipient', { field: 'recipientId' });
    }
    const { envelope } = await mutate(
      rt,
      c.req.param('id'),
      (current) => remind(current, recipientId ? { recipientId } : {}, deps),
      scopeOf(c),
    );
    return c.json(apiEnvelope(envelope));
  });

  app.get('/:id/events', async (c) => {
    const envelope = await getEnvelope(rt, c.req.param('id'), scopeOf(c));
    const events = await rt.store.listEvents(envelope.id);
    const chain = await verifyChain(events, rt.hasher, chainOptions(envelope));
    return c.json({ events, chainValid: chain.valid });
  });

  app.get('/:id/documents/:docId', async (c) => {
    const envelope = await getEnvelope(rt, c.req.param('id'), scopeOf(c));
    const document = envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!document) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    const version = c.req.query('version');
    if (
      version !== undefined &&
      version !== 'original' &&
      version !== 'sealed' &&
      version !== 'certificate' &&
      version !== 'provider-audit-trail'
    ) {
      throw validation('version must be original, sealed, certificate or provider-audit-trail', {
        field: 'version',
      });
    }
    if (version === 'certificate') {
      const certificate = await rt.files.get(certificateFileKey(envelope.id, document.id));
      if (!certificate) {
        throw new SignError(
          'INVALID_STATE',
          'This document has no separate certificate; it is the last page of the sealed file',
        );
      }
      const withTrail = certificatesWithAuditTrail(await rt.store.listEvents(envelope.id));
      return pdfResponse(
        c,
        certificate,
        document.name,
        withTrail.has(document.id)
          ? { filename: certificateWithAuditTrailName(envelope) }
          : 'certificate',
      );
    }
    if (version === 'provider-audit-trail') {
      const trail = await providerAuditTrailFile(rt, envelope);
      if (!trail) {
        throw new SignError(
          'INVALID_STATE',
          'There is no audit trail from the eSign provider for this document',
        );
      }
      return pdfResponse(c, trail.bytes, document.name, { filename: trail.filename });
    }
    const sealed =
      version === 'original' ? null : await rt.files.get(sealedFileKey(envelope.id, document.id));
    if (version === 'sealed' && !sealed) {
      throw new SignError('INVALID_STATE', 'The document has not been sealed yet');
    }
    const bytes = sealed ?? (await rt.files.get(document.fileKey));
    if (!bytes) throw new SignError('ENVELOPE_NOT_FOUND', 'Document file not found');
    return pdfResponse(c, bytes, document.name, sealed ? 'sealed' : 'original');
  });

  app.get('/:id/documents/:docId/verification', async (c) => {
    const envelope = await getEnvelope(rt, c.req.param('id'), scopeOf(c));
    const document = envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!document) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    const sealed = await rt.files.get(sealedFileKey(envelope.id, document.id));
    if (!sealed) throw new SignError('INVALID_STATE', 'The document has not been sealed yet');
    if (!rt.sealTrust || !rt.pdf.verify) {
      throw new SignError('INVALID_STATE', 'This server cannot verify sealed files');
    }
    const sha256 = sha256Hex(sealed);
    const check = await rt.pdf.verify(sealed, {
      trust: rt.sealTrust,
      allowEarlierSignatures: true,
    });
    const asIs = check.valid ? null : await recordedAsIs(rt, sealed, sha256, check);
    return c.json({
      documentId: document.id,
      valid: check.valid || asIs !== null,
      reason: asIs ? null : (check.reason ?? null),
      signer: check.signer ?? null,
      signedAt: check.signedAt ?? null,
      certificateSha256: check.certificateSha256 ?? null,
      sha256,
      seal: asIs?.seal ?? 'operator',
      earlierSignatures: asIs?.earlierSignatures ?? (check.earlierSignatures ?? []).map(earlier),
    });
  });

  app.get('/:id/audit-trail', async (c) => {
    const scope = scopeOf(c);
    const envelope = await getEnvelope(rt, c.req.param('id'), scope);
    const trail = await auditTrailFile(rt, envelope, scope.workspaceId);
    if (!trail) throw new SignError('INVALID_STATE', 'This server cannot draw an audit trail');
    return pdfResponse(c, trail, envelope.title, 'audit-trail');
  });

  app.get('/:id/certificate', async (c) => {
    const envelope = await getEnvelope(rt, c.req.param('id'), scopeOf(c));
    const events = await rt.store.listEvents(envelope.id);
    const chain = await verifyChain(events, rt.hasher, chainOptions(envelope));
    return c.json(certificateView(envelope, events, chain.valid));
  });

  revisionRoutes(app, rt);
  return app;
}

/** Every event must belong to this envelope and end at the head it records. */
const chainOptions = (envelope: Envelope) => ({
  envelopeId: envelope.id,
  ...(envelope.auditHead ? { expectedHead: envelope.auditHead } : {}),
});

function applyDraftChange(rt: Runtime, current: Envelope, body: Record<string, unknown>): Envelope {
  if (current.status !== 'draft') {
    throw new SignError('INVALID_STATE', 'Only draft envelopes can be changed', {
      status: current.status,
    });
  }
  const settings = parseSettings(body, rt.clock.now(), false);
  let next = updateEnvelope(
    current,
    {
      ...(settings.title !== undefined ? { title: settings.title } : {}),
      ...(typeof settings.message === 'string' ? { message: settings.message } : {}),
      ...(typeof settings.changeNote === 'string' && settings.changeNote.trim()
        ? { changeNote: settings.changeNote.trim() }
        : {}),
      ...(settings.routing ? { routing: settings.routing } : {}),
      ...(settings.reminders ? { reminders: settings.reminders } : {}),
      ...(settings.expiresAt ? { expiresAt: settings.expiresAt } : {}),
      ...(settings.metadata ? { metadata: settings.metadata } : {}),
    },
    { clock: rt.clock },
  );
  if (settings.message === null) {
    next = { ...next };
    delete next.message;
  }
  if (settings.changeNote === null || settings.changeNote?.trim() === '') {
    next = { ...next };
    delete next.changeNote;
  }
  const documentKeys = new Map<string, Id>();
  current.documents.forEach((d, i) => {
    documentKeys.set(String(i), d.id);
    documentKeys.set(d.id, d.id);
  });
  return applyParties(
    next,
    documentKeys,
    body.recipients !== undefined
      ? parseRecipients(
          body,
          current.recipients.map((r) => r.id),
        )
      : undefined,
    body.fields !== undefined ? parseFields(body) : undefined,
    rt.ids,
  );
}

async function getEnvelope(rt: Runtime, id: Id, scope: { workspaceId: string }) {
  return (await loadScoped(rt, id, scope)).envelope;
}

function parseListQuery(query: Record<string, string>): EnvelopeListQuery {
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw validation('limit must be a whole number from 1 to 100', { field: 'limit' });
  }
  const status = query.status
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const value of status ?? []) {
    if (!STATUSES.includes(value as EnvelopeStatus)) {
      throw validation(`status must be one of ${STATUSES.join(', ')}`, { field: 'status' });
    }
  }
  const search = query.q?.trim().slice(0, 200);
  return {
    limit,
    ...(status?.length ? { status: status as EnvelopeStatus[] } : {}),
    ...(search ? { search } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}
