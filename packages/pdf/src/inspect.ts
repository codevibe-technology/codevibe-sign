import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { SignError, type PageSize } from '@codevibe/sign-core';
import { pageGeometry } from './geometry';

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export interface InspectOptions {
  /** Largest accepted file in bytes. Defaults to 25 MB. */
  maxBytes?: number;
}

export interface PdfInfo {
  pageCount: number;
  /**
   * Each page as displayed (crop box, after page rotation), in PDF points. This is the
   * space field rects are placed in, and maps directly onto `Document.pageSizes`.
   */
  pages: PageSize[];
}

/** Lowercase hex SHA-256 of the bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const PDF_MAGIC = '%PDF-';

function hasPdfHeader(bytes: Uint8Array): boolean {
  // The header may follow a little leading garbage; readers accept it within the first 1 KB.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return head.includes(PDF_MAGIC);
}

function encrypted(): SignError {
  return new SignError(
    'DOCUMENT_INVALID',
    'The PDF is encrypted or password protected. Remove the protection and upload it again.',
    { reason: 'encrypted' },
  );
}

/** Encrypted files keep their trailer (or xref stream) dictionary readable, /Encrypt included. */
function declaresEncryption(bytes: Uint8Array): boolean {
  return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(Buffer.from(bytes).toString('latin1'));
}

/**
 * Loads a PDF defensively: size cap, header check, no encryption, at least one page.
 * Every failure becomes a SignError so callers can show a precise message.
 */
export async function loadPdf(
  bytes: Uint8Array,
  options: InspectOptions = {},
): Promise<PDFDocument> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (bytes.byteLength > maxBytes) {
    throw new SignError('DOCUMENT_TOO_LARGE', `The PDF is larger than ${maxBytes} bytes.`, {
      size: bytes.byteLength,
      maxBytes,
    });
  }
  if (bytes.byteLength === 0 || !hasPdfHeader(bytes)) {
    throw new SignError('DOCUMENT_INVALID', 'The file is not a PDF.');
  }

  let doc: PDFDocument;
  try {
    // Loading with ignoreEncryption and checking afterwards avoids relying on pdf-lib's
    // error classes, whose instanceof checks do not survive its ES5 build.
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    if (declaresEncryption(bytes)) {
      throw encrypted();
    }
    throw new SignError('DOCUMENT_INVALID', 'The PDF could not be read. It may be damaged.', {
      reason: 'unreadable',
    });
  }

  if (doc.isEncrypted) {
    throw encrypted();
  }
  if (doc.getPageCount() === 0) {
    throw new SignError('DOCUMENT_INVALID', 'The PDF has no pages.', { reason: 'empty' });
  }
  return doc;
}

/** Reads page count and displayed page sizes, rejecting files the signing flow cannot use. */
export async function inspectPdf(
  bytes: Uint8Array,
  options: InspectOptions = {},
): Promise<PdfInfo> {
  const doc = await loadPdf(bytes, options);
  const pages = doc.getPages().map((page) => {
    const geometry = pageGeometry(page);
    return { width: geometry.width, height: geometry.height };
  });
  return { pageCount: pages.length, pages };
}
