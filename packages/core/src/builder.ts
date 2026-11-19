import type { Clock, IdGenerator } from './ports';
import type {
  AuthMethod,
  Document,
  Envelope,
  Field,
  FieldType,
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
  fail,
  MAX_NAME_LENGTH,
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
  /** Defaults to `sequential`. */
  routing?: RoutingMode;
  /** Defaults to `DEFAULT_REMINDERS`. */
  reminders?: ReminderPolicy;
  expiresAt?: IsoDateTime;
  metadata?: Record<string, string>;
}

export type EnvelopePatch = Partial<
  Pick<Envelope, 'title' | 'message' | 'routing' | 'reminders' | 'expiresAt' | 'metadata'>
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
  /** Defaults to `email_link` with an email address, otherwise `sms_otp`. */
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
  return issues;
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

/** Removes a document and every field placed on it. */
export function removeDocument(envelope: Envelope, documentId: Id): Envelope {
  assertDraft(envelope);
  if (!envelope.documents.some((d) => d.id === documentId)) {
    fail(`documents.${documentId}`, 'Document not found in this envelope');
  }
  return {
    ...envelope,
    documents: envelope.documents.filter((d) => d.id !== documentId),
    fields: envelope.fields.filter((f) => f.documentId !== documentId),
  };
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
    auth: input.auth ?? (email ? 'email_link' : 'sms_otp'),
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
  return {
    ...envelope,
    recipients: envelope.recipients.filter((r) => r.id !== recipientId),
    fields: envelope.fields.filter((f) => f.recipientId !== recipientId),
  };
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
  return { ...envelope, fields: envelope.fields.filter((f) => f.id !== fieldId) };
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
  for (const signer of actors.filter((r) => r.role === 'signer')) {
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
  issues.push(...reminderIssues(envelope.reminders), ...expiryIssues(envelope.expiresAt, now));
  return issues;
}

export function assertReadyToSend(envelope: Envelope, now: Date): void {
  throwIf(validateForSend(envelope, now));
}
