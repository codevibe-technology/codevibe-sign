import { SignError } from '@codevibe_technology/sign-core';
import type { PdfEngine } from '../engine';

const encoder = new TextEncoder();

function append(pdf: Uint8Array, text: string): Uint8Array {
  const tail = encoder.encode(text);
  const out = new Uint8Array(pdf.byteLength + tail.byteLength);
  out.set(pdf);
  out.set(tail, pdf.byteLength);
  return out;
}

/** A PDF stand-in the fake engine understands: `%PDF-1.7` then `pages=<n>`. */
export function fakePdf(pages = 1): Uint8Array {
  return encoder.encode(`%PDF-1.7\npages=${pages}\n`);
}

/** Records what the server asked for, so tests can check sealing without real PDFs. */
export function fakePdfEngine(overrides: Partial<PdfEngine> = {}): PdfEngine {
  return {
    async inspectPdf(pdf) {
      const match = /pages=(\d+)/.exec(new TextDecoder().decode(pdf.subarray(0, 64)));
      if (!match) throw new SignError('DOCUMENT_INVALID', 'Could not read the PDF');
      const pageCount = Number(match[1]);
      return {
        pageCount,
        pages: Array.from({ length: pageCount }, () => ({ width: 612, height: 792 })),
      };
    },
    async renderFields(pdf, fields, values) {
      return append(pdf, `fields=${fields.length};values=${values.length}\n`);
    },
    async appendCertificate(pdf, input) {
      return append(pdf, `certificate=${input.envelope.id};events=${input.events.length}\n`);
    },
    async seal(pdf, options) {
      return append(pdf, `sealed;reason=${options.reason}\n`);
    },
    ...overrides,
  };
}
