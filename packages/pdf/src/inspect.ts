import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { SignError, type PageSize } from '@codevibe_technology/sign-core';
import { pageGeometry, type Rotation } from './geometry';
import { checkParseLimits, type ParseLimits } from './limits';
import { assertUnsigned } from './signatures';

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export interface InspectOptions {
  /** Largest accepted file in bytes. Defaults to 25 MB. */
  maxBytes?: number;
  /**
   * Parser limits enforced in a worker thread before the file is read on the calling thread:
   * pages, objects, nesting depth, decoded stream bytes and time. See `DEFAULT_PARSE_LIMITS`.
   */
  limits?: Partial<ParseLimits>;
}

export interface PdfInfo {
  pageCount: number;
  /**
   * Each page as displayed (crop box, after page rotation), in PDF points. This is the
   * space field rects are placed in, and maps directly onto `Document.pageSizes`.
   */
  pages: PageSize[];
  /**
   * Each page's crop box in unrotated user space and its clockwise rotation: what a box
   * placed on the displayed page needs to be expressed in PDF user space, for example for an
   * eSign provider that draws its own signature appearance.
   */
  boxes: PageBox[];
}

export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
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

function unreadable(): SignError {
  return new SignError('DOCUMENT_INVALID', 'The PDF could not be read. It may be damaged.', {
    reason: 'unreadable',
  });
}

/** Encrypted files keep their trailer (or xref stream) dictionary readable, /Encrypt included. */
function declaresEncryption(bytes: Uint8Array): boolean {
  return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(Buffer.from(bytes).toString('latin1'));
}

function assertSizeAndHeader(bytes: Uint8Array, options: InspectOptions): void {
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
}

/**
 * Loads a PDF defensively: size cap, header check, no encryption, at least one page.
 * Every failure becomes a SignError so callers can show a precise message. It parses on the
 * calling thread without limits; untrusted uploads go through `inspectPdf` first.
 */
export async function loadPdf(
  bytes: Uint8Array,
  options: InspectOptions = {},
): Promise<PDFDocument> {
  assertSizeAndHeader(bytes, options);

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
    throw unreadable();
  }

  if (doc.isEncrypted) {
    throw encrypted();
  }
  try {
    // pdf-lib parses lazily: a missing catalog, a broken or cyclic page tree or a malformed
    // page box only surfaces when the pages are read, so read them all here, once.
    for (const page of doc.getPages()) pageGeometry(page);
  } catch {
    throw unreadable();
  }
  if (doc.getPageCount() === 0) {
    throw new SignError('DOCUMENT_INVALID', 'The PDF has no pages.', { reason: 'empty' });
  }
  return doc;
}

/**
 * Reads page count and displayed page sizes, rejecting files the signing flow cannot use,
 * including files that already carry digital signatures (`PDF_ALREADY_SIGNED`). Use it on
 * every upload: it enforces the parser limits in a worker thread that is killed when the file
 * takes too long, before the file is parsed here.
 */
export async function inspectPdf(
  bytes: Uint8Array,
  options: InspectOptions = {},
): Promise<PdfInfo> {
  assertSizeAndHeader(bytes, options);
  await checkParseLimits(bytes, options.limits);
  const doc = await loadPdf(bytes, options);
  assertUnsigned(doc);
  const geometries = doc.getPages().map(pageGeometry);
  const pages = geometries.map(({ width, height }) => ({ width, height }));
  const boxes = geometries.map(({ box, rotation }) => ({ ...box, rotation }));
  return { pageCount: pages.length, pages, boxes };
}
