import { deflateSync, inflateSync } from 'node:zlib';
import {
  degrees,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFStream,
} from 'pdf-lib';
import type {
  AuditAction,
  AuditEvent,
  Document,
  Envelope,
  Field,
  FieldType,
  Recipient,
} from '@codevibe_technology/sign-core';

export interface PageSpec {
  size: [number, number];
  rotation?: number;
  cropBox?: [number, number, number, number];
  /** Leave the page empty instead of drawing a line of text on it. */
  blank?: boolean;
}

export async function makePdf(pages: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const page = doc.addPage(spec.size);
    if (spec.rotation) {
      page.setRotation(degrees(spec.rotation));
    }
    if (spec.cropBox) {
      page.setCropBox(...spec.cropBox);
    }
    if (!spec.blank) {
      page.drawText('Offer letter', { x: 40, y: 40, size: 12 });
    }
  }
  return doc.save();
}

export const A4: [number, number] = [595.28, 841.89];

/** A PDF whose trailer declares encryption, which is all a reader needs to refuse it. */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(A4);
  const encrypt = doc.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    O: PDFString.of('x'.repeat(32)),
    U: PDFString.of('y'.repeat(32)),
    P: -44,
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return doc.save({ useObjectStreams: false });
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGBA PNG of the given size. */
export function makePng(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) {
    row.set([20, 40, 160, 255], 1 + x * 4);
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

export const pngBase64 = (width: number, height: number) =>
  Buffer.from(makePng(width, height)).toString('base64');

export function recipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    id: 'r1',
    name: 'Shubh Kumar',
    email: 'shubh@example.com',
    role: 'signer',
    order: 1,
    auth: 'email_otp',
    status: 'signed',
    actedAt: '2026-11-19T10:15:03.000Z',
    ...overrides,
  };
}

export function field(type: FieldType, overrides: Partial<Field> = {}): Field {
  return {
    id: `f-${type}`,
    documentId: 'd1',
    recipientId: 'r1',
    type,
    page: 0,
    rect: { x: 50, y: 100, width: 200, height: 50 },
    required: true,
    ...overrides,
  };
}

export function document(overrides: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    name: 'Offer letter.pdf',
    sha256: 'a'.repeat(64),
    pageCount: 1,
    fileKey: 'files/d1.pdf',
    ...overrides,
  };
}

export function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env_01J9Z6Q4',
    title: 'Offer letter for Shubh Kumar',
    status: 'completed',
    routing: 'sequential',
    documents: [document()],
    recipients: [recipient()],
    fields: [],
    values: [],
    reminders: { firstAfterDays: 2, everyDays: 2, max: 3 },
    createdAt: '2026-11-18T09:00:00.000Z',
    sentAt: '2026-11-18T09:01:00.000Z',
    completedAt: '2026-11-19T10:15:03.000Z',
    auditHead: 'f'.repeat(64),
    ...overrides,
  };
}

export function event(
  seq: number,
  action: AuditAction,
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    seq,
    envelopeId: 'env_01J9Z6Q4',
    action,
    at: new Date(Date.UTC(2026, 10, 18, 9, 0, seq)).toISOString(),
    prevHash: seq.toString(16).padStart(64, '0'),
    hash: (seq + 1).toString(16).padStart(64, '0'),
    ...overrides,
  };
}

function streamBytes(stream: PDFStream): Uint8Array {
  if (!(stream instanceof PDFRawStream)) {
    return stream.getContents();
  }
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  const contents = stream.getContents();
  return filter === PDFName.of('FlateDecode') ? inflateSync(contents) : contents;
}

/** The decoded content streams of a page, joined in drawing order. */
export async function pageContent(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return refs
    .map((ref) => {
      const stream = doc.context.lookup(ref as PDFRef) as PDFStream;
      return Buffer.from(streamBytes(stream)).toString('latin1');
    })
    .join('\n');
}

/** Text drawn with hex strings (how pdf-lib writes standard-font text), in order. */
export function shownText(content: string): string[] {
  return [...content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((match) =>
    Buffer.from(match[1] ?? '', 'hex').toString('latin1'),
  );
}

export function numbers(text: string): number[] {
  return text.trim().split(/\s+/).map(Number);
}

/**
 * Reads the QR code drawn on a page back out of its content stream: the white square and the
 * dark runs inside it, painted into RGBA pixels a QR decoder accepts.
 */
export function qrPixels(
  content: string,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const boxes = [...content.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    width: Number(m[3]),
    height: Number(m[4]),
  }));
  const [frame, ...runs] = boxes;
  if (!frame || runs.length === 0) {
    return null;
  }
  const scale = 8 / Math.min(...runs.map((run) => run.height));
  const side = Math.round(frame.width * scale);
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const run of runs) {
    const left = Math.round((run.x - frame.x) * scale);
    const top = Math.round((frame.y + frame.height - run.y - run.height) * scale);
    const right = Math.round((run.x + run.width - frame.x) * scale);
    const bottom = top + Math.round(run.height * scale);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        data.fill(0, (y * side + x) * 4, (y * side + x) * 4 + 3);
      }
    }
  }
  return { data, width: side, height: side };
}
