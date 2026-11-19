import {
  SignError,
  addDocument,
  createEnvelope,
  send,
  updateEnvelope,
  verifyChain,
  voidEnvelope,
  type Envelope,
  type Id,
  type TransitionResult,
} from '@codevibe/sign-core';
import { Hono, type Context } from 'hono';
import { sha256Hex } from '../crypto';
import { applyParties } from '../draft';
import { VersionConflictError, validation } from '../errors';
import { authenticate } from '../http/auth';
import { pdfResponse, readJson } from '../http/body';
import { idempotency } from '../http/idempotency';
import { enforce } from '../http/rate-limit';
import {
  parseBase64Documents,
  parseFields,
  parseJsonObject,
  parseRecipients,
  parseSettings,
  type UploadedDocument,
} from '../input';
import type { Runtime } from '../runtime/context';
import { create, mutate } from '../runtime/mutate';
import { sealedFileKey } from '../runtime/seal';
import { certificateView } from '../views';

type SenderEnv = { Variables: { apiKeyId: string } };

const originalFileKey = (envelopeId: Id, index: number) =>
  `envelopes/${envelopeId}/documents/${index}/original.pdf`;

export function senderRoutes(rt: Runtime) {
  const app = new Hono<SenderEnv>();
  const deps = { clock: rt.clock, ids: rt.ids };

  app.use('*', async (c, next) => {
    c.set('apiKeyId', authenticate(c.req.header('authorization'), rt.apiKeys));
    await next();
  });
  app.use(
    '*',
    idempotency(
      rt.store,
      (c) => `key:${c.get('apiKeyId')}`,
      () => rt.clock.now(),
    ),
  );

  app.post('/', async (c) => {
    const now = rt.clock.now();
    const limit = rt.limits.envelopesPerMinute;
    await enforce(rt.limiter, `envelopes:${c.get('apiKeyId')}`, limit, 60_000, now);
    const { body, documents } = await readCreateBody(c, rt);
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

    const created = createEnvelope(
      {
        title: settings.title ?? '',
        ...(settings.routing ? { routing: settings.routing } : {}),
        ...(settings.reminders ? { reminders: settings.reminders } : {}),
        ...(settings.message ? { message: settings.message } : {}),
        ...(settings.expiresAt ? { expiresAt: settings.expiresAt } : {}),
        ...(settings.metadata ? { metadata: settings.metadata } : {}),
      },
      deps,
    );
    let envelope = created.envelope;
    const documentKeys = new Map<string, Id>();
    documents.forEach((upload, i) => {
      const info = infos[i]!;
      const added = addDocument(
        envelope,
        {
          name: upload.name,
          sha256: sha256Hex(upload.bytes),
          pageCount: info.pageCount,
          pageSizes: info.pages,
          fileKey: originalFileKey(envelope.id, i),
        },
        deps,
      );
      envelope = added.envelope;
      documentKeys.set(upload.key, added.document.id);
      documentKeys.set(added.document.id, added.document.id);
    });
    envelope = applyParties(envelope, documentKeys, recipients, fields, rt.ids);

    let result: TransitionResult = { ...created, envelope };
    if (body.send === true) {
      const sent = send(envelope, deps);
      result = {
        envelope: sent.envelope,
        events: [...created.events, ...sent.events],
        effects: [...created.effects, ...sent.effects],
      };
    }

    const keys = envelope.documents.map((d) => d.fileKey);
    await Promise.all(
      documents.map((upload, i) => rt.files.put(keys[i]!, upload.bytes, 'application/pdf')),
    );
    try {
      return c.json(await create(rt, result), 201);
    } catch (err) {
      await Promise.allSettled(keys.map((key) => rt.files.delete(key)));
      throw err;
    }
  });

  app.get('/:id', async (c) => c.json(await getEnvelope(rt, c.req.param('id'))));

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
      const stored = await rt.store.load(c.req.param('id'));
      if (!stored) throw new SignError('ENVELOPE_NOT_FOUND', 'Envelope not found');
      const next = applyDraftChange(rt, stored.envelope, body);
      try {
        await rt.store.commit(next, [], stored.version, []);
      } catch (err) {
        if (err instanceof VersionConflictError && attempt < 2) continue;
        throw err;
      }
      return c.json(next);
    }
  });

  app.post('/:id/send', async (c) => {
    const { envelope } = await mutate(rt, c.req.param('id'), (current) => send(current, deps));
    return c.json(envelope);
  });

  app.post('/:id/void', async (c) => {
    const body = parseJsonObject(await readJson(c, true));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw validation('reason is required', { field: 'reason' });
    const { envelope } = await mutate(rt, c.req.param('id'), (current) =>
      voidEnvelope(current, { reason }, deps),
    );
    return c.json(envelope);
  });

  app.get('/:id/events', async (c) => {
    const envelope = await getEnvelope(rt, c.req.param('id'));
    const events = await rt.store.listEvents(envelope.id);
    const chain = await verifyChain(events, rt.hasher, chainOptions(envelope));
    return c.json({ events, chainValid: chain.valid });
  });

  app.get('/:id/documents/:docId', async (c) => {
    const envelope = await getEnvelope(rt, c.req.param('id'));
    const document = envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!document) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    const version = c.req.query('version');
    if (version !== undefined && version !== 'original' && version !== 'sealed') {
      throw validation('version must be original or sealed', { field: 'version' });
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
    const envelope = await getEnvelope(rt, c.req.param('id'));
    const document = envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!document) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    const sealed = await rt.files.get(sealedFileKey(envelope.id, document.id));
    if (!sealed) throw new SignError('INVALID_STATE', 'The document has not been sealed yet');
    if (!rt.sealTrust || !rt.pdf.verify) {
      throw new SignError('INVALID_STATE', 'This server cannot verify sealed files');
    }
    const check = await rt.pdf.verify(sealed, { trust: rt.sealTrust });
    return c.json({
      documentId: document.id,
      valid: check.valid,
      reason: check.reason ?? null,
      signer: check.signer ?? null,
      signedAt: check.signedAt ?? null,
      certificateSha256: check.certificateSha256 ?? null,
      sha256: sha256Hex(sealed),
    });
  });

  app.get('/:id/certificate', async (c) => {
    const envelope = await getEnvelope(rt, c.req.param('id'));
    const events = await rt.store.listEvents(envelope.id);
    const chain = await verifyChain(events, rt.hasher, chainOptions(envelope));
    return c.json(certificateView(envelope, events, chain.valid));
  });

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

async function getEnvelope(rt: Runtime, id: Id): Promise<Envelope> {
  const envelope = await rt.store.get(id);
  if (!envelope) throw new SignError('ENVELOPE_NOT_FOUND', 'Envelope not found');
  return envelope;
}

async function readCreateBody(c: Context, rt: Runtime) {
  const type = c.req.header('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) {
    const body = parseJsonObject(await readJson(c));
    return { body, documents: parseBase64Documents(body, rt.limits.maxDocuments) };
  }
  const form = await c.req.parseBody({ all: true });
  const raw = form.envelope;
  if (typeof raw !== 'string') {
    throw validation('Send the envelope as JSON in a form field named "envelope"');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw validation('The "envelope" form field must be valid JSON');
  }
  const body = parseJsonObject(parsed, 'envelope');
  const files = ([] as unknown[])
    .concat(form.documents ?? [])
    .filter((f): f is File => f instanceof File);
  if (files.length === 0 || files.length > rt.limits.maxDocuments) {
    throw validation(`Attach 1 to ${rt.limits.maxDocuments} PDF files as "documents"`);
  }
  const described = Array.isArray(body.documents) ? body.documents : [];
  const documents: UploadedDocument[] = await Promise.all(
    files.map(async (file, i) => {
      const meta: unknown = described[i];
      const record =
        typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
      const key = typeof record.key === 'string' ? record.key : String(i);
      const name = typeof record.name === 'string' ? record.name : file.name || `Document ${i + 1}`;
      return { key, name: name.slice(0, 200), bytes: new Uint8Array(await file.arrayBuffer()) };
    }),
  );
  return { body, documents };
}

async function checkPdf(rt: Runtime, upload: UploadedDocument) {
  if (upload.bytes.byteLength > rt.limits.maxPdfBytes) {
    throw new SignError(
      'DOCUMENT_TOO_LARGE',
      `${upload.name} is larger than ${rt.limits.maxPdfBytes} bytes`,
      { document: upload.key, maxBytes: rt.limits.maxPdfBytes },
    );
  }
  if (Buffer.from(upload.bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    throw new SignError('DOCUMENT_INVALID', `${upload.name} is not a PDF file`, {
      document: upload.key,
    });
  }
  try {
    return await rt.pdf.inspectPdf(upload.bytes, { maxBytes: rt.limits.maxPdfBytes });
  } catch (err) {
    if (err instanceof SignError) throw err;
    // A parser crash on a hostile or broken file is the file's fault, not the server's.
    throw new SignError('DOCUMENT_INVALID', `${upload.name} could not be read as a PDF`, {
      document: upload.key,
    });
  }
}
