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

/** One digital signature of a file, as `verifySignatures` in the PDF package reports it. */
export interface SignatureSummary {
  /** The signature matches the bytes it covers. Trust in its certificate is not checked. */
  valid: boolean;
  coversWholeDocument: boolean;
  signer?: { commonName?: string; organization?: string };
  issuer?: { commonName?: string; organization?: string };
  signedAt?: string;
  certificateSha256?: string;
}

export interface SealCheck {
  valid: boolean;
  reason?: string;
  /** Signatures made before the seal, such as an Aadhaar eSign, earliest first. */
  earlierSignatures?: SignatureSummary[];
  signer?: { commonName?: string; organization?: string };
  signedAt?: string;
  certificateSha256?: string;
}

/** Who sent an envelope and where its record can be looked up, for the certificate page. */
export interface CertificateDetails {
  sender?: {
    name: string;
    /** The company or workspace the sender acts for. */
    organization?: string;
    /** Printed masked. */
    email?: string;
  };
  /** Link to a page that shows this signing's record; printed as a QR code and as text. */
  recordUrl?: string;
}

export interface CertificateInput extends CertificateDetails {
  envelope: Envelope;
  document: Document;
  events: AuditEvent[];
  /** The workspace's line for the end of the certificate, from `certificateNote`. */
  note?: string;
  /** IANA zone the times are also shown in, next to UTC. */
  timeZone?: string;
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
    /** `esignProvider` is the provider an Aadhaar eSign box names, such as "Leegality". */
    options: { documentId: string; timeZone?: string; esignProvider?: string },
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
  /**
   * Checks a sealed file: one intact signature over every byte, from a trusted certificate.
   * With `allowEarlierSignatures` the seal may be the last of several, each of them intact.
   */
  verify?(
    pdf: Uint8Array,
    options: { trust: SealTrust; allowEarlierSignatures?: boolean },
  ): Promise<SealCheck>;
  /**
   * Seals a file that already carries digital signatures without changing a byte of it.
   * Throws `PDF_ALREADY_SIGNED` with `details.reason: 'locked'` when the file allows no
   * further signature. Needed, with the next two, for Aadhaar eSign.
   */
  countersign?(pdf: Uint8Array, options: SealOptions): Promise<Uint8Array>;
  /** Every digital signature of a file, earliest first. */
  verifySignatures?(pdf: Uint8Array): Promise<SignatureSummary[]>;
  /** The signing certificate as a file of its own. */
  certificatePdf?(input: CertificateInput): Promise<Uint8Array>;
  /**
   * The envelope's audit trail as a PDF, sent with the completed copy and offered for
   * download. Without it the completed copy carries the signed files only.
   */
  auditTrailPdf?(input: AuditTrailInput): Promise<Uint8Array>;
}

export interface AuditTrailInput {
  envelope: Envelope;
  events: AuditEvent[];
  /** IANA zone the times are shown in, next to UTC. */
  timeZone?: string;
  /** Print the network address of each event where one was recorded. */
  networkAddresses?: boolean;
}

export const defaultPdfEngine: PdfEngine = {
  inspectPdf: (pdf, options) => signPdf.inspectPdf(pdf, options),
  renderFields: (pdf, fields, values, recipients, options) =>
    signPdf.renderFields(pdf, fields, values, recipients, options),
  appendCertificate: (pdf, input) => signPdf.appendCertificate(pdf, input),
  seal: (pdf, options) => signPdf.seal(pdf, options),
  sealCertificate: (options) => signPdf.sealCertificate(options),
  verify: (pdf, options) => signPdf.verify(pdf, options),
  countersign: (pdf, options) => signPdf.countersign(pdf, options),
  verifySignatures: (pdf) => signPdf.verifySignatures(pdf),
  certificatePdf: (input) => signPdf.certificatePdf(input),
  auditTrailPdf: ({ networkAddresses, ...data }) =>
    signPdf.auditTrailPdf(data, networkAddresses ? { networkAddresses } : {}),
};
