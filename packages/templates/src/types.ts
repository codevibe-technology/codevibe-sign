import type {
  AuthMethod,
  FieldType,
  PageSize,
  Rect,
  RecipientRole,
  ReminderPolicy,
  RoutingMode,
} from '@codevibe/sign-core';

export interface TemplateDocument {
  name: string;
  /** Key in the FileStore. Fields refer to their document by this key, so it must be unique. */
  fileKey: string;
  /** SHA-256 hex of the file. */
  sha256: string;
  /** Size of each page in PDF points, in page order. The page count is the length. */
  pageSizes: PageSize[];
}

export interface TemplateField {
  /** `fileKey` of the document the field sits on. */
  document: string;
  type: FieldType;
  /** Zero-based page index. */
  page: number;
  rect: Rect;
  /** Defaults to true. */
  required?: boolean;
  /** Text fields are prefilled by label, so give a label to any field you want to prefill. */
  label?: string;
  /**
   * Text fields only. The value comes from `prefill` when the envelope is created and the
   * recipient may not change it, for example an employee code. Needs a label.
   */
  readOnly?: boolean;
}

export interface TemplateRole {
  /** What the sender fills in, for example `Employee` or `HR`. Unique within the template. */
  name: string;
  /** Defaults to `signer`. */
  type?: RecipientRole;
  /**
   * Position in sequential routing; lowest goes first and equal orders act together.
   * Defaults to the role's position among signers and approvers (1, 2, ...).
   */
  order?: number;
  /** Defaults to `email_link` when the person has an email address, otherwise `sms_otp`. */
  auth?: AuthMethod;
  /** Fields this role fills in. Viewers have none. */
  fields?: TemplateField[];
}

export interface Template {
  /** Your own id for the template; copied to `envelope.metadata.templateId`. */
  id?: string;
  title: string;
  message?: string;
  /** Defaults to `sequential`. */
  routing?: RoutingMode;
  /** Defaults to core's `DEFAULT_REMINDERS`. */
  reminders?: ReminderPolicy;
  /** Whole days from creation until the envelope expires. No expiry when left out. */
  expiresInDays?: number;
  documents: TemplateDocument[];
  roles: TemplateRole[];
  /** Copied into every envelope's metadata. */
  metadata?: Record<string, string>;
}

/** The person who takes a role in one envelope. */
export interface RoleAssignment {
  name: string;
  email?: string;
  phone?: string;
  /** Replaces the template's auth method for this person. */
  auth?: AuthMethod;
}

export interface TemplateOverrides {
  title?: string;
  message?: string;
  routing?: RoutingMode;
  reminders?: ReminderPolicy;
  expiresInDays?: number;
  /** An exact expiry; wins over `expiresInDays`. */
  expiresAt?: string;
}

export interface InstantiateInput {
  /** One person per role, keyed by role name. */
  roles: Record<string, RoleAssignment>;
  /** Text field values keyed by field label. */
  prefill?: Record<string, string>;
  metadata?: Record<string, string>;
  overrides?: TemplateOverrides;
}
