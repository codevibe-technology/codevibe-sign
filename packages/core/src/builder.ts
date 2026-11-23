import type { Clock, IdGenerator } from './ports';
import type {
  AuthMethod,
  Document,
  Envelope,
  Field,
  FieldType,
  FieldValue,
  Id,
  IsoDateTime,
  PageSize,
  Recipient,
  RecipientRole,
  Rect,
  ReminderPolicy,
  RoutingMode,
  TransitionResult,
} from './types';
import { SignError } from './types';
import {
  checkFieldValue,
  fail,
  isFilled,
  MAX_NAME_LENGTH,
  PREFILLABLE_FIELD_TYPES,
  pageSizeIssues,
  rectIssues,
  recipientIssues,
  reminderIssues,
  validationError,
  type ValidationIssue,
} from './validation';

export const DEFAULT_REMINDERS: ReminderPolicy = { firstAfterDays: 3, everyDays: 3, max: 3 };

export interface CreateEnvelopeInput {
  title: string;
  message?: string;
  changeNote?: string;
  /** Defaults to `sequential`. */
  routing?: RoutingMode;
  /** Defaults to `DEFAULT_REMINDERS`. */
  reminders?: ReminderPolicy;
  expiresAt?: IsoDateTime;
  metadata?: Record<string, string>;
}

export type EnvelopePatch = Partial<
  Pick<
    Envelope,
    'title' | 'message' | 'changeNote' | 'routing' | 'reminders' | 'expiresAt' | 'metadata'
  >
>;

export interface DocumentInput {
  name: string;
  sha256: string;
  pageCount: number;
  fileKey: string;
  pageSizes?: PageSize[];
}

export interface RecipientInput {
  name: string;
  email?: string;
  phone?: string;
  /** Defaults to `signer`. */
  role?: RecipientRole;
  /** Defaults to one after the highest signer or approver order (viewers default to 1). */
  order?: number;
  /** Defaults to `email_otp` with an email address, otherwise `sms_otp`. */
  auth?: AuthMethod;
}

export type RecipientPatch = Partial<RecipientInput>;

export interface FieldInput {
  documentId: Id;
  recipientId: Id;
  type: FieldType;
  page: number;
  rect: Rect;
  /** Defaults to true. */
  required?: boolean;
  label?: string;
  /** The sender prefills it and the recipient cannot change it. Text, name and checkbox only. */
  readOnly?: boolean;
}

export interface FieldMove {
  rect: Rect;
  page?: number;
  documentId?: Id;
}

const ACTOR_ROLES: readonly RecipientRole[] = ['signer', 'approver'];

export const isActor = (recipient: Recipient): boolean => ACTOR_ROLES.includes(recipient.role);

function assertDraft(envelope: Envelope): void {
  if (envelope.status !== 'draft') {
    throw new SignError(
      'INVALID_STATE',
      `Envelope can only be edited as a draft (it is ${envelope.status})`,
      {
        status: envelope.status,
      },
    );
  }
}

function throwIf(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw validationError(issues);
}

function titleIssues(title: string): ValidationIssue[] {
  const trimmed = title.trim();
  if (!trimmed) return [{ path: 'title', message: 'Title is required' }];
  if (trimmed.length > MAX_NAME_LENGTH) {
    return [{ path: 'title', message: `Title is longer than ${MAX_NAME_LENGTH} characters` }];
  }
  return [];
}

function expiryIssues(expiresAt: IsoDateTime | undefined, now: Date): ValidationIssue[] {
  if (expiresAt === undefined) return [];
  const time = Date.parse(expiresAt);
  if (Number.isNaN(time))
    return [{ path: 'expiresAt', message: 'Expiry must be an ISO date-time' }];
  if (time <= now.getTime())
    return [{ path: 'expiresAt', message: 'Expiry must be in the future' }];
  return [];
}

function findRecipient(envelope: Envelope, recipientId: Id): Recipient {
  const recipient = envelope.recipients.find((r) => r.id === recipientId);
  if (!recipient) {
    throw new SignError('RECIPIENT_NOT_FOUND', 'Recipient not found in this envelope', {
      recipientId,
    });
  }
  return recipient;
}

function findField(envelope: Envelope, fieldId: Id): Field {
  const field = envelope.fields.find((f) => f.id === fieldId);
  if (!field) fail(`fields.${fieldId}`, 'Field not found in this envelope');
  return field;
}

function fieldIssues(
  envelope: Envelope,
  field: Omit<Field, 'id'>,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const document = envelope.documents.find((d) => d.id === field.documentId);
  const recipient = envelope.recipients.find((r) => r.id === field.recipientId);
  if (!document)
    issues.push({ path: `${path}.documentId`, message: 'Document not found in this envelope' });
  if (!recipient) {
    issues.push({ path: `${path}.recipientId`, message: 'Recipient not found in this envelope' });
  } else if (!isActor(recipient)) {
    issues.push({
      path: `${path}.recipientId`,
      message: 'Fields can only be given to signers and approvers',
    });
  }
  if (document) {
    if (!Number.isInteger(field.page) || field.page < 0 || field.page >= document.pageCount) {
      issues.push({
        path: `${path}.page`,
        message: `Page must be between 0 and ${document.pageCount - 1}`,
      });
    } else {
      issues.push(...rectIssues(field.rect, document.pageSizes?.[field.page], `${path}.rect`));
    }
  }
  if (field.readOnly && !PREFILLABLE_FIELD_TYPES.includes(field.type)) {
    issues.push({
      path: `${path}.readOnly`,
      message: `Only ${PREFILLABLE_FIELD_TYPES.join(', ')} fields can be read-only`,
    });
  }
  return issues;
}

/** Drops values whose field no longer exists. */
function withoutOrphanValues(envelope: Envelope): Envelope {
  const ids = new Set(envelope.fields.map((f) => f.id));
  const values = envelope.values.filter((v) => ids.has(v.fieldId));
  return values.length === envelope.values.length ? envelope : { ...envelope, values };
}

export function createEnvelope(
  input: CreateEnvelopeInput,
  deps: { clock: Clock; ids: IdGenerator },
): TransitionResult {
  const now = deps.clock.now();
  const reminders = input.reminders ?? DEFAULT_REMINDERS;
  throwIf([
    ...titleIssues(input.title),
    ...reminderIssues(reminders),
    ...expiryIssues(input.expiresAt, now),
  ]);
  const envelope: Envelope = {
    id: deps.ids.id(),
    title: input.title.trim(),
    status: 'draft',
    routing: input.routing ?? 'sequential',
    documents: [],
    recipients: [],
    fields: [],
    values: [],
    reminders: { ...reminders },
    createdAt: now.toISOString(),
    ...(input.message !== undefined && { message: input.message }),
    ...(input.changeNote !== undefined && { changeNote: input.changeNote }),
    ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
    ...(input.metadata !== undefined && { metadata: { ...input.metadata } }),
  };
  return {
    envelope,
    events: [
      {
        envelopeId: envelope.id,
        action: 'envelope.created',
        at: envelope.createdAt,
        data: { routing: envelope.routing },
      },
    ],
    effects: [],
  };
}

export function updateEnvelope(
  envelope: Envelope,
  patch: EnvelopePatch,
  deps: { clock: Clock },
): Envelope {
  assertDraft(envelope);
  throwIf([
    ...(patch.title !== undefined ? titleIssues(patch.title) : []),
    ...(patch.reminders !== undefined ? reminderIssues(patch.reminders) : []),
    ...expiryIssues(patch.expiresAt, deps.clock.now()),
  ]);
  return {
    ...envelope,
    ...patch,
    ...(patch.title !== undefined && { title: patch.title.trim() }),
  };
}

export function addDocument(
  envelope: Envelope,
  input: DocumentInput,
  deps: { ids: IdGenerator },
): { envelope: Envelope; document: Document } {
  assertDraft(envelope);
  const issues: ValidationIssue[] = [];
  if (!input.name.trim())
    issues.push({ path: 'document.name', message: 'Document name is required' });
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    issues.push({
      path: 'document.sha256',
      message: 'SHA-256 must be 64 lowercase hex characters',
    });
  }
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) {
    issues.push({ path: 'document.pageCount', message: 'A document needs at least one page' });
  } else if (input.pageSizes) {
    issues.push(...pageSizeIssues(input.pageSizes, input.pageCount, 'document.pageSizes'));
  }
  if (!input.fileKey) issues.push({ path: 'document.fileKey', message: 'File key is required' });
  throwIf(issues);

  const document: Document = {
    id: deps.ids.id(),
    name: input.name.trim(),
    sha256: input.sha256,
    pageCount: input.pageCount,
    fileKey: input.fileKey,
    ...(input.pageSizes && { pageSizes: input.pageSizes.map((s) => ({ ...s })) }),
  };
  return { envelope: { ...envelope, documents: [...envelope.documents, document] }, document };
}

export interface DocumentReplacement {
  name?: string;
  sha256: string;
  pageCount: number;
  fileKey: string;
  pageSizes?: PageSize[];
}

/**
 * Swaps a draft's document for a new version. Fields stay where they were when their page
 * still exists and they fit on it; the others are moved onto the nearest page inside its
 * edges and returned in `moved`, so the sender can check them.
 */
export function replaceDocument(
  envelope: Envelope,
  documentId: Id,
  input: DocumentReplacement,
): { envelope: Envelope; moved: Id[] } {
  assertDraft(envelope);
  const current = envelope.documents.find((d) => d.id === documentId);
  if (!current) {
    throw new SignError('VALIDATION', 'Document not found in this envelope', {
      issues: [{ path: 'documentId', message: 'Document not found in this envelope' }],
    });
  }
  const document: Document = {
    id: current.id,
    name: input.name?.trim() || current.name,
    sha256: input.sha256,
    pageCount: input.pageCount,
    fileKey: input.fileKey,
    ...(input.pageSizes && { pageSizes: input.pageSizes.map((s) => ({ ...s })) }),
  };
  const issues: ValidationIssue[] = [];
  if (!/^[0-9a-f]{64}$/.test(document.sha256)) {
    issues.push({
      path: 'document.sha256',
      message: 'SHA-256 must be 64 lowercase hex characters',
    });
  }
  if (!Number.isInteger(document.pageCount) || document.pageCount < 1) {
    issues.push({ path: 'document.pageCount', message: 'A document needs at least one page' });
  } else if (document.pageSizes) {
    issues.push(...pageSizeIssues(document.pageSizes, document.pageCount, 'document.pageSizes'));
  }
  throwIf(issues);

  const next = {
    ...envelope,
    documents: envelope.documents.map((d) => (d.id === documentId ? document : d)),
  };
  const moved: Id[] = [];
  const fields = next.fields.map((field) => {
    if (field.documentId !== documentId) return field;
    if (fieldIssues(next, field, 'field').length === 0) return field;
    moved.push(field.id);
    const page = Math.min(Math.max(field.page, 0), document.pageCount - 1);
    const size = document.pageSizes?.[page];
    if (!size) return { ...field, page };
    const width = Math.min(field.rect.width, size.width);
    const height = Math.min(field.rect.height, size.height);
    const rect = {
      width,
      height,
      x: Math.min(Math.max(field.rect.x, 0), size.width - width),
      y: Math.min(Math.max(field.rect.y, 0), size.height - height),
    };
    return { ...field, page, rect };
  });
  return { envelope: { ...next, fields }, moved };
}

/** Removes a document and every field placed on it. */
export function removeDocument(envelope: Envelope, documentId: Id): Envelope {
  assertDraft(envelope);
  if (!envelope.documents.some((d) => d.id === documentId)) {
    fail(`documents.${documentId}`, 'Document not found in this envelope');
  }
  return withoutOrphanValues({
    ...envelope,
    documents: envelope.documents.filter((d) => d.id !== documentId),
    fields: envelope.fields.filter((f) => f.documentId !== documentId),
  });
}

function defaultOrder(envelope: Envelope, role: RecipientRole): number {
  if (role === 'viewer') return 1;
  const orders = envelope.recipients.filter(isActor).map((r) => r.order);
  return orders.length === 0 ? 1 : Math.max(...orders) + 1;
}

function cleanContact(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function addRecipient(
  envelope: Envelope,
  input: RecipientInput,
  deps: { ids: IdGenerator },
): { envelope: Envelope; recipient: Recipient } {
  assertDraft(envelope);
  const role = input.role ?? 'signer';
  const email = cleanContact(input.email);
  const phone = cleanContact(input.phone)?.replace(/[\s-]/g, '');
  const recipient: Recipient = {
    id: deps.ids.id(),
    name: input.name.trim(),
    role,
    order: input.order ?? defaultOrder(envelope, role),
    auth: input.auth ?? (email ? 'email_otp' : 'sms_otp'),
    status: 'pending',
    ...(email && { email }),
    ...(phone && { phone }),
  };
  throwIf(recipientIssues(recipient, 'recipient'));
  return { envelope: { ...envelope, recipients: [...envelope.recipients, recipient] }, recipient };
}

export function updateRecipient(
  envelope: Envelope,
  recipientId: Id,
  patch: RecipientPatch,
): Envelope {
  assertDraft(envelope);
  const current = findRecipient(envelope, recipientId);
  const next: Recipient = { ...current };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.role !== undefined) next.role = patch.role;
  if (patch.order !== undefined) next.order = patch.order;
  if (patch.auth !== undefined) next.auth = patch.auth;
  if ('email' in patch) {
    const email = cleanContact(patch.email);
    if (email) next.email = email;
    else delete next.email;
  }
  if ('phone' in patch) {
    const phone = cleanContact(patch.phone)?.replace(/[\s-]/g, '');
    if (phone) next.phone = phone;
    else delete next.phone;
  }
  const path = `recipients.${recipientId}`;
  const issues = recipientIssues(next, path);
  if (next.role === 'viewer' && envelope.fields.some((f) => f.recipientId === recipientId)) {
    issues.push({
      path: `${path}.role`,
      message: 'Remove this recipient’s fields before making them a viewer',
    });
  }
  throwIf(issues);
  return {
    ...envelope,
    recipients: envelope.recipients.map((r) => (r.id === recipientId ? next : r)),
  };
}

/** Removes a recipient and every field assigned to them. */
export function removeRecipient(envelope: Envelope, recipientId: Id): Envelope {
  assertDraft(envelope);
  findRecipient(envelope, recipientId);
  return withoutOrphanValues({
    ...envelope,
    recipients: envelope.recipients.filter((r) => r.id !== recipientId),
    fields: envelope.fields.filter((f) => f.recipientId !== recipientId),
  });
}

export function addField(
  envelope: Envelope,
  input: FieldInput,
  deps: { ids: IdGenerator },
): { envelope: Envelope; field: Field } {
  assertDraft(envelope);
  const draft: Omit<Field, 'id'> = {
    documentId: input.documentId,
    recipientId: input.recipientId,
    type: input.type,
    page: input.page,
    rect: { ...input.rect },
    required: input.required ?? true,
    ...(input.label !== undefined && { label: input.label }),
    ...(input.readOnly === true && { readOnly: true }),
  };
  throwIf(fieldIssues(envelope, draft, 'field'));
  const field: Field = { id: deps.ids.id(), ...draft };
  return { envelope: { ...envelope, fields: [...envelope.fields, field] }, field };
}

export function moveField(envelope: Envelope, fieldId: Id, to: FieldMove): Envelope {
  assertDraft(envelope);
  const current = findField(envelope, fieldId);
  const moved: Field = {
    ...current,
    rect: { ...to.rect },
    page: to.page ?? current.page,
    documentId: to.documentId ?? current.documentId,
  };
  throwIf(fieldIssues(envelope, moved, `fields.${fieldId}`));
  return { ...envelope, fields: envelope.fields.map((f) => (f.id === fieldId ? moved : f)) };
}

export function removeField(envelope: Envelope, fieldId: Id): Envelope {
  assertDraft(envelope);
  findField(envelope, fieldId);
  return withoutOrphanValues({
    ...envelope,
    fields: envelope.fields.filter((f) => f.id !== fieldId),
  });
}

function prefillIssues(field: Field | undefined, path: string): ValidationIssue[] {
  if (!field) return [{ path, message: 'Field not found in this envelope' }];
  if (!PREFILLABLE_FIELD_TYPES.includes(field.type)) {
    return [
      {
        path,
        message: `Only ${PREFILLABLE_FIELD_TYPES.join(', ')} fields can be prefilled; the recipient fills in ${field.type} fields`,
      },
    ];
  }
  return [];
}

/**
 * Sets values the sender fills in before sending, for example an employee code. Values
 * are checked like submitted ones; an empty value clears the field. Recipients may change
 * prefilled values unless the field is `readOnly`.
 */
export function prefillFields(envelope: Envelope, values: readonly FieldValue[]): Envelope {
  assertDraft(envelope);
  const issues: ValidationIssue[] = [];
  const next = new Map<Id, string>();
  for (const { fieldId, value } of values) {
    const path = `values.${fieldId}`;
    const field = envelope.fields.find((f) => f.id === fieldId);
    const found = prefillIssues(field, path);
    if (found.length > 0) {
      issues.push(...found);
      continue;
    }
    if (next.has(fieldId)) {
      issues.push({ path, message: 'Value given more than once' });
      continue;
    }
    if (typeof value !== 'string') {
      issues.push({ path, message: 'Value must be a string' });
      continue;
    }
    const checked = checkFieldValue(field!.type, value);
    if (checked.ok) next.set(fieldId, checked.value);
    else issues.push({ path, message: checked.problem });
  }
  throwIf(issues);

  const kept = envelope.values.filter((v) => !next.has(v.fieldId));
  const set = [...next].filter(([, value]) => value !== '');
  return {
    ...envelope,
    values: [...kept, ...set.map(([fieldId, value]) => ({ fieldId, value }))],
  };
}

function valueIssues(envelope: Envelope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { fieldId, value } of envelope.values) {
    const path = `values.${fieldId}`;
    const field = envelope.fields.find((f) => f.id === fieldId);
    const found = prefillIssues(field, path);
    if (found.length > 0) {
      issues.push(...found);
      continue;
    }
    const checked = checkFieldValue(field!.type, value);
    if (!checked.ok) issues.push({ path, message: checked.problem });
  }
  const filled = new Map(envelope.values.map((v) => [v.fieldId, v.value]));
  for (const field of envelope.fields) {
    // Name fields fall back to the recipient's name at signing, so they never stay empty.
    if (field.type === 'name' || !field.readOnly || !field.required) continue;
    if (!isFilled(field, filled.get(field.id))) {
      issues.push({
        path: `fields.${field.id}`,
        message: 'Prefill this read-only field; the recipient cannot fill it in',
      });
    }
  }
  return issues;
}

/**
 * An Aadhaar eSign is a signature over the finished file, and nothing but another signature
 * can be added after it. So one signer may use it, on a single document, and they sign last.
 */
export function aadhaarIssues(envelope: Envelope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const aadhaar = envelope.recipients.filter((r) => r.auth === 'aadhaar');
  if (aadhaar.length === 0) return issues;
  for (const recipient of aadhaar.filter((r) => r.role !== 'signer')) {
    issues.push({
      path: `recipients.${recipient.id}.auth`,
      message: `Aadhaar eSign is for signers; choose another way for ${recipient.name}`,
    });
  }
  for (const recipient of aadhaar.slice(1)) {
    issues.push({
      path: `recipients.${recipient.id}.auth`,
      message: 'Only one recipient of an envelope can sign with Aadhaar eSign',
    });
  }
  if (envelope.documents.length > 1) {
    issues.push({
      path: 'documents',
      message: 'An envelope signed with Aadhaar eSign can hold one document',
    });
  }
  const signer = aadhaar[0]!;
  if (signer.role === 'signer') issues.push(...aadhaarFieldIssues(envelope, signer));
  const others = envelope.recipients.filter((r) => isActor(r) && r.id !== signer.id);
  if (others.length > 0 && envelope.routing !== 'sequential') {
    issues.push({
      path: 'routing',
      message: `${signer.name} signs with Aadhaar eSign and must sign last; use sequential routing`,
    });
  } else if (others.some((r) => r.order >= signer.order)) {
    issues.push({
      path: `recipients.${signer.id}.order`,
      message: `${signer.name} signs with Aadhaar eSign and must be the last to act`,
    });
  }
  return issues;
}

/** Field types that only stood for "the signature goes here" for an Aadhaar eSign signer. */
const AADHAAR_SIGNATURE_MARKS: readonly Field['type'][] = ['aadhaar', 'signature', 'initials'];

/**
 * An Aadhaar eSign signer signs the whole file at the eSign provider, which places the
 * signature where its own workflow says. So they have no fields here: the file the provider
 * signs is exactly what the sender approved, with the values of the signers before them.
 */
function aadhaarFieldIssues(envelope: Envelope, signer: Recipient): ValidationIssue[] {
  return envelope.fields
    .filter((f) => f.recipientId === signer.id)
    .map((field) => ({
      path: `fields.${field.id}`,
      message: AADHAAR_SIGNATURE_MARKS.includes(field.type)
        ? `${signer.name} signs with Aadhaar eSign; the provider places the signature, so remove this ${field.type === 'aadhaar' ? 'Aadhaar eSign box' : `${field.type} field`}`
        : `${signer.name} signs with Aadhaar eSign and fills in nothing here; remove this ${field.type.replace('_', ' ')} field or give it to a signer before them`,
    }));
}

/** An `aadhaar` field given to a recipient who does not sign with Aadhaar eSign. */
function strayAadhaarBoxes(envelope: Envelope): ValidationIssue[] {
  return envelope.fields
    .filter((f) => f.type === 'aadhaar')
    .filter((f) => envelope.recipients.find((r) => r.id === f.recipientId)?.auth !== 'aadhaar')
    .map((f) => ({
      path: `fields.${f.id}`,
      message: 'Only a signer who uses Aadhaar eSign can have an Aadhaar eSign box',
    }));
}

/**
 * Removes the fields that marked where an Aadhaar eSign signer signs: an `aadhaar` box, or
 * the signature and initials fields envelopes and templates gave them before. The provider
 * places the signature itself, so these carry nothing. Other fields are left for
 * `validateForSend` to refuse, since dropping them would lose what the sender asked for.
 */
export function dropAadhaarSignatureFields(envelope: Envelope): Envelope {
  const signers = new Set(
    envelope.recipients.filter((r) => r.auth === 'aadhaar' && r.role === 'signer').map((r) => r.id),
  );
  const dropped = new Set(
    envelope.fields
      .filter((f) => signers.has(f.recipientId) && AADHAAR_SIGNATURE_MARKS.includes(f.type))
      .map((f) => f.id),
  );
  if (dropped.size === 0) return envelope;
  return {
    ...envelope,
    fields: envelope.fields.filter((f) => !dropped.has(f.id)),
    values: envelope.values.filter((v) => !dropped.has(v.fieldId)),
  };
}

/** Everything that must hold before an envelope can be sent. Empty means ready. */
export function validateForSend(envelope: Envelope, now: Date): ValidationIssue[] {
  const issues: ValidationIssue[] = [...titleIssues(envelope.title)];
  if (envelope.documents.length === 0) {
    issues.push({ path: 'documents', message: 'Add at least one document' });
  }
  const actors = envelope.recipients.filter(isActor);
  if (actors.length === 0) {
    issues.push({ path: 'recipients', message: 'Add at least one signer or approver' });
  }
  for (const recipient of envelope.recipients) {
    issues.push(...recipientIssues(recipient, `recipients.${recipient.id}`));
  }
  for (const signer of actors.filter((r) => r.role === 'signer' && r.auth !== 'aadhaar')) {
    const hasSignature = envelope.fields.some(
      (f) => f.recipientId === signer.id && f.type === 'signature' && f.required,
    );
    if (!hasSignature) {
      issues.push({
        path: `recipients.${signer.id}.fields`,
        message: `Place at least one required signature field for ${signer.name}`,
      });
    }
  }
  for (const field of envelope.fields) {
    issues.push(...fieldIssues(envelope, field, `fields.${field.id}`));
  }
  issues.push(...valueIssues(envelope), ...aadhaarIssues(envelope), ...strayAadhaarBoxes(envelope));
  issues.push(...reminderIssues(envelope.reminders), ...expiryIssues(envelope.expiresAt, now));
  return issues;
}

export function assertReadyToSend(envelope: Envelope, now: Date): void {
  throwIf(validateForSend(envelope, now));
}
