import type {
  AuditEvent,
  Document,
  Envelope,
  Field,
  FieldValue,
  PageSize,
  Recipient,
} from '@codevibe/sign-core';
import * as signPdf from '@codevibe/sign-pdf';

export interface PdfInfo {
  pageCount: number;
  /** Page sizes in PDF points, in page order. */
  pages: PageSize[];
}

export interface SealOptions {
  p12: Uint8Array;
  passphrase: string;
  reason: string;
  location: string;
  signingTime: Date;
}

export interface CertificateInput {
  envelope: Envelope;
  document: Document;
  events: AuditEvent[];
}

/**
 * The PDF operations the server needs. The default is `@codevibe/sign-pdf`; tests and
 * integrators with their own PDF stack can pass another implementation.
 */
export interface PdfEngine {
  /** Parses defensively; throws `DOCUMENT_INVALID` or `DOCUMENT_TOO_LARGE`. */
  inspectPdf(pdf: Uint8Array, options: { maxBytes: number }): Promise<PdfInfo>;
  renderFields(
    pdf: Uint8Array,
    fields: Field[],
    values: FieldValue[],
    recipients: Recipient[],
    options: { documentId: string },
  ): Promise<Uint8Array>;
  appendCertificate(pdf: Uint8Array, input: CertificateInput): Promise<Uint8Array>;
  /** Must be the last change to the file: anything after it breaks the seal. */
  seal(pdf: Uint8Array, options: SealOptions): Promise<Uint8Array>;
}

export const defaultPdfEngine: PdfEngine = {
  inspectPdf: (pdf, options) => signPdf.inspectPdf(pdf, options),
  renderFields: (pdf, fields, values, recipients, options) =>
    signPdf.renderFields(pdf, fields, values, recipients, options),
  appendCertificate: (pdf, input) => signPdf.appendCertificate(pdf, input),
  seal: (pdf, options) => signPdf.seal(pdf, options),
};
