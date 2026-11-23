import { SignError, type Id } from '@codevibe_technology/sign-core';
import type { Context, MiddlewareHandler } from 'hono';
import { HttpError, validation } from '../errors';
import { authenticate } from '../http/auth';
import { readJson } from '../http/body';
import { parseBase64Documents, parseJsonObject, type UploadedDocument } from '../input';
import type { Runtime } from '../runtime/context';
import { DEFAULT_WORKSPACE, type Principal } from '../tenancy';

export type SenderEnv = { Variables: { principal: Principal } };

/**
 * Resolves the caller of a sender route, from `authenticate` or an API key, and keeps a
 * read-only credential to `GET`. `what` names the resource in the refusal.
 */
export function senderAuth(rt: Runtime, what = 'envelopes'): MiddlewareHandler<SenderEnv> {
  return async (c, next) => {
    const principal =
      (rt.authenticate ? await rt.authenticate(c.req.raw) : null) ??
      authenticate(c.req.header('authorization'), rt.apiKeys);
    if (!principal.id || !principal.workspaceId) {
      throw new HttpError('UNAUTHORIZED', 'The credential has no workspace');
    }
    if (principal.readOnly && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      throw new HttpError('FORBIDDEN', `This credential can only read ${what}`);
    }
    c.set('principal', principal);
    await next();
  };
}

/**
 * The JSON and the PDFs of a create request: either one JSON body with base64 documents, or
 * a multipart form with the JSON in the field named `part` and the files as `documents`.
 */
export async function readUploadBody(c: Context, rt: Runtime, part: 'envelope' | 'template') {
  const type = c.req.header('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) {
    const body = parseJsonObject(await readJson(c));
    return { body, documents: parseBase64Documents(body, rt.limits.maxDocuments) };
  }
  const form = await c.req.parseBody({ all: true });
  const raw = form[part];
  if (typeof raw !== 'string') {
    throw validation(`Send the ${part} as JSON in a form field named "${part}"`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw validation(`The "${part}" form field must be valid JSON`);
  }
  const body = parseJsonObject(parsed, part);
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

export const originalFileKey = (envelopeId: Id, index: number) =>
  `envelopes/${envelopeId}/documents/${index}/original.pdf`;

/**
 * The stored envelope, if it belongs to the caller's workspace. One in another workspace is
 * reported exactly like one that does not exist, so ids cannot be probed across workspaces.
 */
export async function loadScoped(rt: Runtime, id: Id, scope: { workspaceId: string }) {
  const stored = await rt.store.load(id);
  if (!stored || (stored.workspaceId ?? DEFAULT_WORKSPACE) !== scope.workspaceId) {
    throw new SignError('ENVELOPE_NOT_FOUND', 'Envelope not found');
  }
  return stored;
}

/** Size, signature and page sizes of an uploaded PDF; refuses what is not a readable PDF. */
export async function checkPdf(rt: Runtime, upload: UploadedDocument) {
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
