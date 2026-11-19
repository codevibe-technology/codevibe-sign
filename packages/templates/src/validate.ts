import {
  MAX_NAME_LENGTH,
  SignError,
  type AuthMethod,
  type FieldType,
  type PageSize,
  type Rect,
  type RecipientRole,
  type ReminderPolicy,
  type ValidationIssue,
} from '@codevibe/sign-core';
import type { Template, TemplateDocument, TemplateField, TemplateRole } from './types';

const ROUTING_MODES = ['sequential', 'parallel'];
const ROLE_TYPES: readonly RecipientRole[] = ['signer', 'approver', 'viewer'];
const AUTH_METHODS: readonly AuthMethod[] = ['email_link', 'email_otp', 'sms_otp', 'aadhaar'];
const FIELD_TYPES: readonly FieldType[] = [
  'signature',
  'initials',
  'date_signed',
  'name',
  'text',
  'checkbox',
];

export function validationError(issues: ValidationIssue[]): SignError {
  const first = issues[0];
  const message = first ? `${first.message} (${first.path})` : 'Invalid input';
  return new SignError('VALIDATION', message, { issues });
}

export function throwIf(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw validationError(issues);
}

export const roleKey = (name: string): string => name.trim().toLowerCase();

export const isActorRole = (role: TemplateRole): boolean => (role.type ?? 'signer') !== 'viewer';

const wholeDays = (n: number) => Number.isInteger(n) && n >= 0;

function textIssues(value: unknown, path: string, label: string): ValidationIssue[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [{ path, message: `${label} is required` }];
  }
  if (value.trim().length > MAX_NAME_LENGTH) {
    return [{ path, message: `${label} is longer than ${MAX_NAME_LENGTH} characters` }];
  }
  return [];
}

export function reminderIssues(policy: ReminderPolicy, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!wholeDays(policy.firstAfterDays)) {
    issues.push({
      path: `${path}.firstAfterDays`,
      message: 'Must be a whole number of days, 0 or more',
    });
  }
  if (!wholeDays(policy.everyDays)) {
    issues.push({
      path: `${path}.everyDays`,
      message: 'Must be a whole number of days, 0 or more',
    });
  }
  if (!wholeDays(policy.max)) {
    issues.push({ path: `${path}.max`, message: 'Must be a whole number, 0 or more' });
  }
  if (policy.firstAfterDays > 0 && policy.max > 1 && policy.everyDays < 1) {
    issues.push({
      path: `${path}.everyDays`,
      message: 'Set at least 1 day between reminders when more than one is allowed',
    });
  }
  return issues;
}

export function expiryDaysIssues(days: number | undefined, path: string): ValidationIssue[] {
  if (days === undefined || (Number.isInteger(days) && days >= 1)) return [];
  return [{ path, message: 'Expiry must be a whole number of days, at least 1' }];
}

function pageSizeIssues(sizes: unknown, path: string): ValidationIssue[] {
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return [{ path, message: 'Give the size of every page (at least one)' }];
  }
  const bad = (sizes as PageSize[]).findIndex(
    (s) =>
      !Number.isFinite(s?.width) || !Number.isFinite(s?.height) || s.width <= 0 || s.height <= 0,
  );
  return bad === -1
    ? []
    : [{ path: `${path}.${bad}`, message: 'Page width and height must be greater than 0' }];
}

function documentIssues(documents: TemplateDocument[]): ValidationIssue[] {
  if (!Array.isArray(documents) || documents.length === 0) {
    return [{ path: 'documents', message: 'Add at least one document' }];
  }
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  documents.forEach((doc, i) => {
    const path = `documents.${i}`;
    issues.push(...textIssues(doc.name, `${path}.name`, 'Document name'));
    if (!doc.fileKey) {
      issues.push({ path: `${path}.fileKey`, message: 'File key is required' });
    } else if (seen.has(doc.fileKey)) {
      issues.push({ path: `${path}.fileKey`, message: 'Each document needs its own file key' });
    }
    seen.add(doc.fileKey);
    if (typeof doc.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.sha256)) {
      issues.push({
        path: `${path}.sha256`,
        message: 'SHA-256 must be 64 lowercase hex characters',
      });
    }
    issues.push(...pageSizeIssues(doc.pageSizes, `${path}.pageSizes`));
  });
  return issues;
}

function rectIssues(rect: Rect, page: PageSize | undefined, path: string): ValidationIssue[] {
  const values = [rect?.x, rect?.y, rect?.width, rect?.height];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return [{ path, message: 'Position and size must be finite numbers' }];
  }
  const issues: ValidationIssue[] = [];
  if (rect.width <= 0 || rect.height <= 0) {
    issues.push({ path, message: 'Width and height must be greater than 0' });
  }
  if (rect.x < 0 || rect.y < 0) {
    issues.push({ path, message: 'The box starts outside the page' });
  }
  if (page && (rect.x + rect.width > page.width || rect.y + rect.height > page.height)) {
    issues.push({
      path,
      message: `The box runs past the page edge (page is ${page.width} x ${page.height} pt)`,
    });
  }
  return issues;
}

function fieldIssues(
  field: TemplateField,
  documents: TemplateDocument[],
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!FIELD_TYPES.includes(field.type)) {
    issues.push({
      path: `${path}.type`,
      message: `Field type must be one of ${FIELD_TYPES.join(', ')}`,
    });
  }
  const document = documents.find((d) => d.fileKey === field.document);
  if (!document) {
    issues.push({
      path: `${path}.document`,
      message: 'No document in this template has that file key',
    });
  } else if (Array.isArray(document.pageSizes)) {
    const pageCount = document.pageSizes.length;
    if (!Number.isInteger(field.page) || field.page < 0 || field.page >= pageCount) {
      issues.push({ path: `${path}.page`, message: `Page must be between 0 and ${pageCount - 1}` });
    } else {
      issues.push(...rectIssues(field.rect, document.pageSizes[field.page], `${path}.rect`));
    }
  }
  if (field.readOnly) {
    if (field.type !== 'text') {
      issues.push({ path: `${path}.readOnly`, message: 'Only text fields can be read-only' });
    }
    if (!field.label?.trim()) {
      issues.push({
        path: `${path}.label`,
        message: 'A read-only field needs a label to prefill it by',
      });
    }
  }
  return issues;
}

function roleIssues(
  role: TemplateRole,
  documents: TemplateDocument[],
  path: string,
): ValidationIssue[] {
  const issues = textIssues(role.name, `${path}.name`, 'Role name');
  const type = role.type ?? 'signer';
  if (!ROLE_TYPES.includes(type)) {
    issues.push({
      path: `${path}.type`,
      message: `Role type must be one of ${ROLE_TYPES.join(', ')}`,
    });
  }
  if (role.order !== undefined && !(Number.isInteger(role.order) && role.order >= 1)) {
    issues.push({ path: `${path}.order`, message: 'Order must be a whole number of at least 1' });
  }
  if (role.auth !== undefined && !AUTH_METHODS.includes(role.auth)) {
    issues.push({
      path: `${path}.auth`,
      message: `Auth must be one of ${AUTH_METHODS.join(', ')}`,
    });
  }
  const fields = role.fields ?? [];
  if (type === 'viewer' && fields.length > 0) {
    issues.push({
      path: `${path}.fields`,
      message: 'Viewers only receive a copy; remove their fields',
    });
    return issues;
  }
  fields.forEach((field, i) =>
    issues.push(...fieldIssues(field, documents, `${path}.fields.${i}`)),
  );
  if (type === 'signer' && !fields.some((f) => f.type === 'signature' && f.required !== false)) {
    issues.push({
      path: `${path}.fields`,
      message: `Place at least one required signature field for ${role.name || 'this role'}`,
    });
  }
  return issues;
}

/** Everything wrong with a template. Empty means it can be used. */
export function validateTemplate(template: Template): ValidationIssue[] {
  const issues = textIssues(template.title, 'title', 'Title');
  if (template.routing !== undefined && !ROUTING_MODES.includes(template.routing)) {
    issues.push({ path: 'routing', message: 'Routing must be sequential or parallel' });
  }
  if (template.reminders) issues.push(...reminderIssues(template.reminders, 'reminders'));
  issues.push(...expiryDaysIssues(template.expiresInDays, 'expiresInDays'));
  issues.push(...documentIssues(template.documents));

  const documents = Array.isArray(template.documents) ? template.documents : [];
  const roles = Array.isArray(template.roles) ? template.roles : [];
  if (!roles.some(isActorRole)) {
    issues.push({ path: 'roles', message: 'Add at least one signer or approver role' });
  }
  const seen = new Set<string>();
  roles.forEach((role, i) => {
    const path = `roles.${i}`;
    issues.push(...roleIssues(role, documents, path));
    const key = typeof role.name === 'string' ? roleKey(role.name) : '';
    if (key && seen.has(key)) {
      issues.push({ path: `${path}.name`, message: `Another role is already called ${role.name}` });
    }
    seen.add(key);
  });
  return issues;
}

export function assertValidTemplate(template: Template): void {
  throwIf(validateTemplate(template));
}
