import { SignError, type Id } from '@codevibe_technology/sign-core';
import type { UploadedDocument } from '../input';
import type { Runtime } from '../runtime/context';
import { DEFAULT_WORKSPACE } from '../tenancy';

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
