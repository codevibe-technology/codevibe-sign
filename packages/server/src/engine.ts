import type {
  AuditEvent,
  Document,
  Envelope,
  Field,
  FieldValue,
  PageSize,
  Recipient,
} from '@codevibe_technology/sign-core';
import * as signPdf from '@codevibe_technology/sign-pdf';

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
  /** Accept weak keys; local development only. */
  allowWeakKey?: boolean;
  /** RFC 3161 timestamp authority for a PAdES B-T seal. */
  tsaUrl?: string;
  /** Fail when the timestamp authority fails. Default true when `tsaUrl` is set. */
  tsaRequired?: boolean;
  /** Called when an optional timestamp could not be obtained. */
  onTimestampFailure?: (error: Error) => void;
}

/** Certificates a sealed file may come from; see `verify` in `@codevibe_technology/sign-pdf`. */
export interface SealTrust {
  certificates?: (string | Uint8Array)[];
  fingerprints?: string[];
  roots?: (string | Uint8Array)[];
}

export interface SealCheck {
  valid: boolean;
  reason?: string;
  signer?: { commonName?: string; organization?: string };
  signedAt?: string;
  certificateSha256?: string;
}

export interface CertificateInput {
  envelope: Envelope;
  document: Document;
  events: AuditEvent[];
  /** The workspace's line for the end of the certificate, from `certificateNote`. */
  note?: string;
}

/**
 * The PDF operations the server needs. The default is `@codevibe_technology/sign-pdf`; tests and
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
  /**
   * Opens the sealing key and returns the certificate's SHA-256, refusing weak or expired
   * keys. Called once at start-up; when present, sealed files are verified against it.
   */
  sealCertificate?(options: { p12: Uint8Array; passphrase: string; allowWeakKey?: boolean }): {
    sha256: string;
  };
  /** Checks a sealed file: one intact signature over every byte, from a trusted certificate. */
  verify?(pdf: Uint8Array, options: { trust: SealTrust }): Promise<SealCheck>;
}

export const defaultPdfEngine: PdfEngine = {
  inspectPdf: (pdf, options) => signPdf.inspectPdf(pdf, options),
  renderFields: (pdf, fields, values, recipients, options) =>
    signPdf.renderFields(pdf, fields, values, recipients, options),
  appendCertificate: (pdf, input) => signPdf.appendCertificate(pdf, input),
  seal: (pdf, options) => signPdf.seal(pdf, options),
  sealCertificate: (options) => signPdf.sealCertificate(options),
  verify: (pdf, options) => signPdf.verify(pdf, options),
};
