import {
  SignError,
  correctRecipient,
  recall,
  recallCopy,
  recordRevision,
  replaceDocument,
  shareLink,
  type Envelope,
} from '@codevibe_technology/sign-core';
import type { Context, Hono } from 'hono';
import { sha256Hex } from '../crypto';
import { validation } from '../errors';
import { readJson } from '../http/body';
import { parseJsonObject } from '../input';
import type { Runtime } from '../runtime/context';
import { create, mutate } from '../runtime/mutate';
import { issueToken } from '../runtime/notify';
import type { StoredEnvelope } from '../store/types';
import { DEFAULT_WORKSPACE, type Principal } from '../tenancy';
import { checkPdf, loadScoped, originalFileKey } from './shared';

type SenderEnv = { Variables: { principal: Principal } };

/** Links a sender may take by hand for one recipient in an hour. */
export const SHARED_LINKS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const actorOf = (c: Context<SenderEnv>) => {
  const principal = c.get('principal');
  return principal.actorName?.trim() || principal.id;
};

const optionalString = (body: Record<string, unknown>, key: string, max: number) => {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw validation(`${key} must be text up to ${max} characters`, { field: key });
  }
  return value;
};

/**
 * Copies the original files of `source` to the keys of `copy` and saves the copy as a new
 * draft in the same workspace. Nothing anyone signed is carried over.
 */
async function saveCopy(
  rt: Runtime,
  source: StoredEnvelope,
  origin: 'recalled' | 'revised',
  by: string,
): Promise<Envelope> {
  const result = recallCopy(
    source.envelope,
    { clock: rt.clock, ids: rt.ids },
    { fileKey: originalFileKey, by, origin },
  );
  const keys = result.envelope.documents.map((d) => d.fileKey);
  await Promise.all(
    source.envelope.documents.map(async (document, i) => {
      const bytes = await rt.files.get(document.fileKey);
      if (!bytes) throw new SignError('ENVELOPE_NOT_FOUND', `The file of ${document.name} is gone`);
      await rt.files.put(keys[i]!, bytes, 'application/pdf');
    }),
  );
  try {
    return await create(rt, result, source.workspaceId ?? DEFAULT_WORKSPACE);
  } catch (err) {
    await Promise.allSettled(keys.map((key) => rt.files.delete(key)));
    throw err;
  }
}

/**
 * Corrections a sender makes after sending: a signing link to pass on by hand, a corrected
 * recipient, recalling an envelope to edit it, revising a declined one, and replacing a draft's
 * file. Mounted on the sender routes, so the caller is authenticated and scoped.
 */
export function revisionRoutes(app: Hono<SenderEnv>, rt: Runtime) {
  const deps = { clock: rt.clock };
  const scopeOf = (c: Context<SenderEnv>) => ({ workspaceId: c.get('principal').workspaceId });

  app.post('/:id/recipients/:recipientId/link', async (c) => {
    const recipientId = c.req.param('recipientId');
    const by = actorOf(c);
    const { envelope } = await mutate(
      rt,
      c.req.param('id'),
      async (current) => {
        const since = rt.clock.now().getTime() - HOUR_MS;
        const recent = (await rt.store.listEvents(current.id)).filter(
          (e) =>
            e.action === 'recipient.link_shared' &&
            e.recipientId === recipientId &&
            Date.parse(e.at) > since,
        );
        if (recent.length >= SHARED_LINKS_PER_HOUR) {
          throw new SignError(
            'RATE_LIMITED',
            `${SHARED_LINKS_PER_HOUR} links were already taken for this person in the last hour. Try again later.`,
            { limit: SHARED_LINKS_PER_HOUR, windowMinutes: 60 },
          );
        }
        return shareLink(current, { recipientId, by }, deps);
      },
      scopeOf(c),
    );
    const recipient = envelope.recipients.find((r) => r.id === recipientId)!;
    const url = await issueToken(rt, envelope, recipient);
    c.header('Cache-Control', 'no-store');
    return c.json({ recipientId, url }, 201);
  });

  app.patch('/:id/recipients/:recipientId', async (c) => {
    const body = parseJsonObject(await readJson(c));
    if (body.resend !== undefined && typeof body.resend !== 'boolean') {
      throw validation('resend must be true or false', { field: 'resend' });
    }
    const name = optionalString(body, 'name', 200);
    const email = optionalString(body, 'email', 254);
    const phone = optionalString(body, 'phone', 20);
    const by = actorOf(c);
    const { envelope } = await mutate(
      rt,
      c.req.param('id'),
      (current) =>
        correctRecipient(
          current,
          c.req.param('recipientId'),
          {
            ...(name !== undefined ? { name } : {}),
            ...(email !== undefined ? { email } : {}),
            ...(phone !== undefined ? { phone } : {}),
            ...(body.resend === true ? { resend: true } : {}),
            by,
          },
          deps,
        ),
      scopeOf(c),
    );
    return c.json(envelope);
  });

  app.post('/:id/recall', async (c) => {
    const body = parseJsonObject(await readJson(c, true));
    const note = optionalString(body, 'note', 900)?.trim();
    const stored = await loadScoped(rt, c.req.param('id'), scopeOf(c));
    const status = stored.envelope.status;
    if (status !== 'sent' && status !== 'in_progress') {
      throw new SignError(
        'INVALID_STATE',
        `Only a sent envelope can be recalled; this one is ${status}`,
        {
          status,
        },
      );
    }
    const by = actorOf(c);
    const draft = await saveCopy(rt, stored, 'recalled', by);
    const { envelope: recalled } = await mutate(
      rt,
      stored.envelope.id,
      (current) =>
        recall(
          current,
          {
            replacementId: draft.id,
            replacementTitle: draft.title,
            ...(note ? { note } : {}),
            by,
          },
          deps,
        ),
      scopeOf(c),
    );
    return c.json({ draft, recalled }, 201);
  });

  app.post('/:id/revise', async (c) => {
    const stored = await loadScoped(rt, c.req.param('id'), scopeOf(c));
    if (stored.envelope.status !== 'declined') {
      throw new SignError(
        'INVALID_STATE',
        `Only a declined envelope can be revised; this one is ${stored.envelope.status}`,
        { status: stored.envelope.status },
      );
    }
    const by = actorOf(c);
    const draft = await saveCopy(rt, stored, 'revised', by);
    const { envelope: declined } = await mutate(
      rt,
      stored.envelope.id,
      (current) =>
        recordRevision(
          current,
          { replacementId: draft.id, replacementTitle: draft.title, by },
          deps,
        ),
      scopeOf(c),
    );
    return c.json({ draft, declined }, 201);
  });

  app.put('/:id/documents/:docId', async (c) => {
    const upload = await readReplacement(c);
    const stored = await loadScoped(rt, c.req.param('id'), scopeOf(c));
    const current = stored.envelope.documents.find((d) => d.id === c.req.param('docId'));
    if (!current) throw new SignError('ENVELOPE_NOT_FOUND', 'Document not found');
    if (stored.envelope.status !== 'draft') {
      throw new SignError('INVALID_STATE', 'Only a draft’s documents can be replaced', {
        status: stored.envelope.status,
      });
    }
    const info = await checkPdf(rt, { key: current.id, ...upload });
    const fileKey = `envelopes/${stored.envelope.id}/documents/${current.id}/${rt.ids.id()}.pdf`;
    const { envelope, moved } = replaceDocument(stored.envelope, current.id, {
      ...(upload.name ? { name: upload.name } : {}),
      sha256: sha256Hex(upload.bytes),
      pageCount: info.pageCount,
      pageSizes: info.pages,
      fileKey,
    });
    await rt.files.put(fileKey, upload.bytes, 'application/pdf');
    try {
      await rt.store.commit(envelope, [], stored.version, []);
    } catch (err) {
      await rt.files.delete(fileKey).catch(() => undefined);
      throw err;
    }
    await rt.files.delete(current.fileKey).catch(() => undefined);
    return c.json({ envelope, movedFields: moved });
  });
}

/** The new file of a document: multipart `document`, or JSON `{ name, content }` in base64. */
async function readReplacement(c: Context): Promise<{ name: string; bytes: Uint8Array }> {
  const type = c.req.header('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    const form = await c.req.parseBody();
    const file = form.document;
    if (!(file instanceof File))
      throw validation('Attach the PDF as a form field named "document"');
    return {
      name: (typeof form.name === 'string' ? form.name : file.name).slice(0, 200),
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }
  const body = parseJsonObject(await readJson(c));
  if (typeof body.content !== 'string' || !body.content) {
    throw validation('content must be the PDF as base64', { field: 'content' });
  }
  const name = typeof body.name === 'string' ? body.name.slice(0, 200) : '';
  return { name, bytes: new Uint8Array(Buffer.from(body.content, 'base64')) };
}
