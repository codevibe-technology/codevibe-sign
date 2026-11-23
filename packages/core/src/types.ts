export type Id = string;
export type IsoDateTime = string;

export type RoutingMode = 'sequential' | 'parallel';

export type EnvelopeStatus =
  | 'draft'
  | 'sent'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'voided';

export const FINAL_ENVELOPE_STATUSES: readonly EnvelopeStatus[] = [
  'completed',
  'declined',
  'expired',
  'voided',
];

export type RecipientRole = 'signer' | 'approver' | 'viewer';

export type RecipientStatus =
  | 'pending'
  | 'notified'
  | 'viewed'
  | 'signed'
  | 'approved'
  | 'declined';

export type AuthMethod = 'email_link' | 'email_otp' | 'sms_otp' | 'aadhaar';

export type FieldType = 'signature' | 'initials' | 'date_signed' | 'name' | 'text' | 'checkbox';

export interface Rect {
  /** PDF points from the left edge of the page. */
  x: number;
  /** PDF points from the top edge of the page. */
  y: number;
  width: number;
  height: number;
}

export interface Field {
  id: Id;
  documentId: Id;
  recipientId: Id;
  type: FieldType;
  /** Zero-based page index. */
  page: number;
  rect: Rect;
  required: boolean;
  label?: string;
  /**
   * The sender fills this field in before sending (see `prefillFields`) and the recipient
   * cannot change it. Allowed on text, name and checkbox fields.
   */
  readOnly?: boolean;
}

export interface FieldValue {
  fieldId: Id;
  /** Signature and initials: PNG bytes as base64. Text and name: the text. Checkbox: 'true' or 'false'. Date: ISO date. */
  value: string;
}

export interface PageSize {
  /** PDF points. */
  width: number;
  height: number;
}

export interface Document {
  id: Id;
  name: string;
  /** SHA-256 hex of the original file. */
  sha256: string;
  pageCount: number;
  /** Key in the FileStore. */
  fileKey: string;
  /** Size of each page, in page order. When present, fields are checked against these bounds. */
  pageSizes?: PageSize[];
}

export interface Recipient {
  id: Id;
  name: string;
  email?: string;
  phone?: string;
  role: RecipientRole;
  /** Used in sequential routing; lowest goes first. Equal orders sign in parallel. */
  order: number;
  auth: AuthMethod;
  status: RecipientStatus;
  declineReason?: string;
  actedAt?: IsoDateTime;
  /** When the invitation was issued; reminders count from here. */
  notifiedAt?: IsoDateTime;
  viewedAt?: IsoDateTime;
  remindersSent?: number;
  lastRemindedAt?: IsoDateTime;
}

export interface ReminderPolicy {
  /** Days after notification for the first reminder; 0 turns reminders off. */
  firstAfterDays: number;
  /** Days between later reminders. */
  everyDays: number;
  /** Maximum reminders per recipient. */
  max: number;
}

export interface Envelope {
  id: Id;
  title: string;
  message?: string;
  /**
   * For an envelope sent again after a decline: what changed since, shown to recipients in the
   * invitation and on the signing page.
   */
  changeNote?: string;
  status: EnvelopeStatus;
  routing: RoutingMode;
  documents: Document[];
  recipients: Recipient[];
  fields: Field[];
  values: FieldValue[];
  reminders: ReminderPolicy;
  expiresAt?: IsoDateTime;
  createdAt: IsoDateTime;
  sentAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  /** Free-form data owned by the integrator (for example an employee id). */
  metadata?: Record<string, string>;
  /** Head of the audit hash chain. */
  auditHead?: string;
}

export type AuditAction =
  | 'envelope.created'
  /** A draft was edited; `data.change` says what changed (see `DraftChange`). */
  | 'envelope.updated'
  | 'envelope.sent'
  | 'envelope.completed'
  | 'envelope.declined'
  | 'envelope.expired'
  | 'envelope.voided'
  /** Voided to be corrected; `data.replacementId` is the draft copy that replaces it. */
  | 'envelope.recalled'
  /** A declined envelope was copied to a new draft, `data.replacementId`, to send again. */
  | 'envelope.revised'
  | 'recipient.notified'
  | 'recipient.reminded'
  | 'recipient.viewed'
  | 'recipient.authenticated'
  | 'recipient.signed'
  | 'recipient.approved'
  | 'recipient.declined'
  /** The sender took a fresh signing link to pass on themselves; no email was sent. */
  | 'recipient.link_shared'
  /** The sender corrected the name or contact of a recipient who had not acted yet. */
  | 'recipient.corrected'
  /** The recipient was sent to the eSign provider; `data.provider` names it. */
  | 'recipient.esign_started'
  /** An eSign did not finish; `data.reason` says why. The recipient may start again. */
  | 'recipient.esign_failed'
  | 'document.sealed';

export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

export interface AuditEvent {
  seq: number;
  envelopeId: Id;
  action: AuditAction;
  at: IsoDateTime;
  recipientId?: Id;
  context?: AuditContext;
  data?: Record<string, string | number | boolean>;
  prevHash: string;
  hash: string;
}

/** An audit event before it is placed in the hash chain. */
export type PendingAuditEvent = Omit<AuditEvent, 'seq' | 'prevHash' | 'hash'>;

/** Something the caller must do after a transition (core never does I/O). */
export type Effect =
  | {
      kind: 'notify';
      recipientId: Id;
      /** `cancelled` tells recipients already invited that the envelope was declined or voided. */
      reason: 'invite' | 'reminder' | 'completed_copy' | 'cancelled';
    }
  | { kind: 'webhook'; event: AuditAction; envelopeId: Id }
  | { kind: 'seal'; envelopeId: Id };

export interface TransitionResult {
  envelope: Envelope;
  events: PendingAuditEvent[];
  effects: Effect[];
}

export type SignErrorCode =
  | 'ENVELOPE_NOT_FOUND'
  | 'INVALID_STATE'
  | 'NOT_YOUR_TURN'
  | 'RECIPIENT_NOT_FOUND'
  | 'REQUIRED_FIELDS_MISSING'
  | 'FIELD_NOT_YOURS'
  | 'INVALID_FIELD_VALUE'
  | 'ENVELOPE_EXPIRED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'RATE_LIMITED'
  | 'TOKEN_INVALID'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_INVALID'
  | 'PDF_ALREADY_SIGNED'
  | 'SEAL_FAILED'
  | 'PROVIDER_ERROR'
  | 'ESIGN_UNAVAILABLE'
  | 'WEBHOOK_INVALID'
  | 'VALIDATION';

export class SignError extends Error {
  readonly code: SignErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: SignErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SignError';
    this.code = code;
    this.details = details;
  }
}
