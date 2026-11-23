import type {
  AuditAction,
  AuditEvent,
  AuthMethod,
  Document as CoreDocument,
  Envelope as CoreEnvelope,
  EnvelopeStatus,
  Field,
  FieldType,
  FieldValue,
  Id,
  IsoDateTime,
  Rect,
  RecipientRole,
  RecipientStatus,
  ReminderPolicy,
  RoutingMode,
  SignErrorCode,
} from '@codevibe_technology/sign-core';

export type {
  AuditAction,
  AuditEvent,
  AuthMethod,
  EnvelopeStatus,
  Field,
  FieldType,
  FieldValue,
  Id,
  IsoDateTime,
  Recipient,
  RecipientRole,
  RecipientStatus,
  Rect,
  ReminderPolicy,
  RoutingMode,
  SignErrorCode,
} from '@codevibe_technology/sign-core';

/** A document as the API describes it. Where the server stores the file is not part of it. */
export type Document = Omit<CoreDocument, 'fileKey'>;

/** An envelope as the API answers with it. */
export type Envelope = Omit<CoreEnvelope, 'documents'> & { documents: Document[] };

/** Error codes the API returns: core's codes plus the HTTP layer's own. */
export type ApiErrorCode =
  | SignErrorCode
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL';

/** Codes the client adds when no response arrived or it could not be read. */
export type ClientErrorCode = 'NETWORK' | 'TIMEOUT' | 'ABORTED' | 'BAD_RESPONSE';

export type PdfContent = Uint8Array | ArrayBuffer | Blob;

export interface DocumentUpload {
  /** How fields refer to this document. Defaults to its position. */
  key?: string;
  name: string;
  content: PdfContent;
}

export interface RecipientSpec {
  /** How fields refer to this recipient. Defaults to its position. */
  key?: string;
  /** On update, the id of an existing recipient to keep. */
  id?: Id;
  name: string;
  email?: string;
  /** International format, like `+919812345678`. */
  phone?: string;
  role?: RecipientRole;
  auth?: AuthMethod;
  order?: number;
}

/** A field box in PDF points from the top-left corner of the page. */
export interface FieldSpec extends Rect {
  /** Key or id of the recipient. */
  recipient: string;
  /** Key or id of the document; leave out when there is one document. */
  document?: string;
  type?: FieldType;
  /** Zero-based page index. */
  page: number;
  required?: boolean;
  label?: string;
}

interface EnvelopeSettings {
  title: string;
  message?: string;
  /** For a revised envelope: what changed, shown to recipients. */
  changeNote?: string;
  routing?: RoutingMode;
  reminders?: ReminderPolicy;
  expiresAt?: IsoDateTime | Date;
  expiresInDays?: number;
  /** Your own data, such as an employee id. Strings only. */
  metadata?: Record<string, string>;
}

export interface CreateEnvelopeInput extends EnvelopeSettings {
  documents: DocumentUpload[];
  recipients: RecipientSpec[];
  fields?: FieldSpec[];
  /** Send right away instead of leaving a draft. */
  send?: boolean;
}

export interface UpdateEnvelopeInput extends Partial<Omit<EnvelopeSettings, 'message'>> {
  /** `null` removes the message. */
  message?: string | null;
  /** Replaces every recipient. Fields refer to documents by id or position. */
  recipients?: RecipientSpec[];
  /** Replaces every field. */
  fields?: FieldSpec[];
}

export interface RecipientCorrection {
  name?: string;
  email?: string;
  phone?: string;
  /** Send a new invitation even when only the name changed. */
  resend?: boolean;
}

export interface EnvelopeEvents {
  events: AuditEvent[];
  /** Whether the audit hash chain is intact. */
  chainValid: boolean;
}

export type DocumentVersion = 'original' | 'sealed';

export interface Certificate {
  envelopeId: Id;
  title: string;
  status: EnvelopeStatus;
  completedAt: IsoDateTime | null;
  auditHead: string | null;
  chainValid: boolean;
  documents: { id: Id; name: string; sha256: string; sealedSha256: string | null }[];
  recipients: {
    id: Id;
    name: string;
    email: string | null;
    phone: string | null;
    role: RecipientRole;
    auth: AuthMethod;
    status: RecipientStatus;
    actions: { action: string; at: IsoDateTime; ip: string | null; userAgent: string | null }[];
  }[];
}

/** What a signer sees: the envelope basics and their own fields. */
export interface SigningSession {
  /** The workspace that sent the envelope, for its brand. */
  workspaceId: string;
  envelope: {
    id: Id;
    title: string;
    message: string | null;
    /** For a revised envelope: what changed, to show above the document. */
    changeNote: string | null;
    status: EnvelopeStatus;
    expiresAt: IsoDateTime | null;
  };
  recipient: {
    id: Id;
    name: string;
    email: string | null;
    role: RecipientRole;
    status: RecipientStatus;
    auth: AuthMethod;
  };
  documents: { id: Id; name: string; pageCount: number }[];
  fields: Field[];
  values: FieldValue[];
  otpRequired: boolean;
  /**
   * While `otpRequired` is true and this is false, `documents`, `fields` and `values` are
   * empty, the message is null and the email address is masked. Call `session()` again after
   * `verifyOtp`.
   */
  authenticated: boolean;
  /** False while earlier signers in a sequential envelope have not acted. */
  canAct: boolean;
  /** IANA zone the signing date is printed in on the document, for example `Asia/Kolkata`. */
  timeZone: string;
}

export interface OtpSent {
  /** Masked address or phone number, or null when there is nowhere to send it. */
  sentTo: string | null;
  expiresAt: IsoDateTime;
}

export interface OtpSession {
  sessionToken: string;
  expiresAt: IsoDateTime;
}

export interface SignerActionResult {
  envelopeStatus: EnvelopeStatus;
  recipientStatus: RecipientStatus;
}

/** The JSON body of a webhook delivery. */
export interface WebhookDelivery {
  id: string;
  type: AuditAction;
  createdAt: IsoDateTime;
  data: {
    envelope: {
      id: Id;
      title: string;
      status: EnvelopeStatus;
      metadata: Record<string, string>;
      completedAt: IsoDateTime | null;
      recipients: {
        id: Id;
        name: string;
        email: string | null;
        role: RecipientRole;
        status: RecipientStatus;
        actedAt: IsoDateTime | null;
      }[];
    };
  };
}
