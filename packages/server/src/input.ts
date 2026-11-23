import {
  DEFAULT_REMINDERS,
  type AuthMethod,
  type FieldInput,
  type FieldType,
  type Id,
  type RecipientInput,
  type RecipientRole,
  type ReminderPolicy,
  type RoutingMode,
} from '@codevibe_technology/sign-core';
import { validation } from './errors';

type Obj = Record<string, unknown>;

const ROUTING: readonly RoutingMode[] = ['sequential', 'parallel'];
const ROLES: readonly RecipientRole[] = ['signer', 'approver', 'viewer'];
const AUTH: readonly AuthMethod[] = ['email_link', 'email_otp', 'sms_otp', 'aadhaar'];
const FIELD_TYPES: readonly FieldType[] = [
  'signature',
  'initials',
  'date_signed',
  'name',
  'text',
  'checkbox',
];
const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;
const PHONE = /^\+[1-9]\d{6,14}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const DEFAULT_EXPIRY_DAYS = 30;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(
  obj: Obj,
  key: string,
  path: string,
  opts: { max: number; optional: true },
): string | undefined;
function str(obj: Obj, key: string, path: string, opts: { max: number }): string;
function str(
  obj: Obj,
  key: string,
  path: string,
  opts: { max: number; optional?: boolean },
): string | undefined {
  const value = obj[key];
  if (value === undefined && opts.optional) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validation(`${path}${key} is required and must be a non-empty string`, {
      field: `${path}${key}`,
    });
  }
  if (value.length > opts.max) {
    throw validation(`${path}${key} must be at most ${opts.max} characters`, {
      field: `${path}${key}`,
    });
  }
  return value.trim();
}

function num(
  obj: Obj,
  key: string,
  path: string,
  opts: { min: number; max: number; int?: boolean },
) {
  const value = obj[key];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < opts.min ||
    value > opts.max ||
    (opts.int && !Number.isInteger(value))
  ) {
    throw validation(
      `${path}${key} must be ${opts.int ? 'an integer' : 'a number'} from ${opts.min} to ${opts.max}`,
      { field: `${path}${key}` },
    );
  }
  return value;
}

function oneOf<T extends string>(
  obj: Obj,
  key: string,
  path: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = obj[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw validation(`${path}${key} must be one of ${allowed.join(', ')}`, {
      field: `${path}${key}`,
    });
  }
  return value as T;
}

function list(obj: Obj, key: string, opts: { min: number; max: number }): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.length < opts.min || value.length > opts.max) {
    throw validation(`${key} must be a list of ${opts.min} to ${opts.max} items`, { field: key });
  }
  return value;
}

export function parseJsonObject(value: unknown, what = 'Request body'): Obj {
  if (!isObj(value)) throw validation(`${what} must be a JSON object`);
  return value;
}

export interface UploadedDocument {
  key: string;
  name: string;
  bytes: Uint8Array;
}

export function parseBase64Documents(body: Obj, maxDocuments: number): UploadedDocument[] {
  return list(body, 'documents', { min: 1, max: maxDocuments }).map((raw, i) => {
    const path = `documents[${i}].`;
    const doc = parseJsonObject(raw, `documents[${i}]`);
    const content = doc.content;
    if (typeof content !== 'string' || content.length === 0 || !BASE64.test(content)) {
      throw validation(`${path}content must be the PDF file as base64`, {
        field: `${path}content`,
      });
    }
    return {
      key: str(doc, 'key', path, { max: 100, optional: true }) ?? String(i),
      name: str(doc, 'name', path, { max: 200 }),
      bytes: new Uint8Array(Buffer.from(content, 'base64')),
    };
  });
}

export interface RecipientSpec {
  /** How fields refer to this recipient in the same request. */
  key: string;
  /** Set when the request names an existing recipient to keep. */
  id?: Id;
  input: RecipientInput;
}

export function parseRecipients(body: Obj, existingIds: Id[]): RecipientSpec[] {
  const parsed = list(body, 'recipients', { min: 1, max: 50 }).map((raw, i): RecipientSpec => {
    const path = `recipients[${i}].`;
    const r = parseJsonObject(raw, `recipients[${i}]`);
    const role = oneOf(r, 'role', path, ROLES, 'signer');
    const auth = oneOf(r, 'auth', path, AUTH, 'email_otp');
    const email = str(r, 'email', path, { max: 254, optional: true })?.toLowerCase();
    const phone = str(r, 'phone', path, { max: 20, optional: true });
    if (email !== undefined && !EMAIL.test(email)) {
      throw validation(`${path}email is not a valid email address`, { field: `${path}email` });
    }
    if (phone !== undefined && !PHONE.test(phone)) {
      throw validation(`${path}phone must be in international format, like +919812345678`, {
        field: `${path}phone`,
      });
    }
    if (
      email === undefined &&
      (role === 'viewer' || auth === 'email_link' || auth === 'email_otp')
    ) {
      throw validation(`${path}email is required for this recipient`, { field: `${path}email` });
    }
    if (phone === undefined && auth === 'sms_otp') {
      throw validation(`${path}phone is required for sms_otp`, { field: `${path}phone` });
    }
    const id = typeof r.id === 'string' && existingIds.includes(r.id) ? r.id : undefined;
    const input: RecipientInput = {
      name: str(r, 'name', path, { max: 200 }),
      role,
      auth,
      ...(r.order !== undefined
        ? { order: num(r, 'order', path, { min: 1, max: 1000, int: true }) }
        : role !== 'viewer'
          ? { order: i + 1 }
          : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
    };
    return {
      key: str(r, 'key', path, { max: 100, optional: true }) ?? id ?? String(i),
      ...(id !== undefined ? { id } : {}),
      input,
    };
  });
  if (new Set(parsed.map((p) => p.key)).size !== parsed.length) {
    throw validation('recipients must have unique keys');
  }
  if (!parsed.some((p) => p.input.role !== 'viewer')) {
    throw validation('At least one recipient must be a signer or an approver');
  }
  return parsed;
}

export interface FieldSpec {
  /** Key or id of the document; undefined when the envelope has one document. */
  document?: string;
  /** Key or id of the recipient. */
  recipient: string;
  input: Omit<FieldInput, 'documentId' | 'recipientId'>;
}

export function parseFields(body: Obj): FieldSpec[] {
  const raw = body.fields === undefined ? [] : list(body, 'fields', { min: 0, max: 500 });
  return raw.map((item, i) => {
    const path = `fields[${i}].`;
    const f = parseJsonObject(item, `fields[${i}]`);
    const ref = (key: string) =>
      typeof f[key] === 'string' || typeof f[key] === 'number' ? String(f[key]) : undefined;
    const recipient = ref('recipient');
    if (recipient === undefined) {
      throw validation(`${path}recipient is required`, { field: `${path}recipient` });
    }
    const rect = isObj(f.rect) ? f.rect : f;
    if (f.required !== undefined && typeof f.required !== 'boolean') {
      throw validation(`${path}required must be true or false`, { field: `${path}required` });
    }
    const label = str(f, 'label', path, { max: 200, optional: true });
    const document = ref('document');
    return {
      recipient,
      ...(document !== undefined ? { document } : {}),
      input: {
        type: oneOf(f, 'type', path, FIELD_TYPES, 'signature'),
        page: num(f, 'page', path, { min: 0, max: 10_000, int: true }),
        rect: {
          x: num(rect, 'x', path, { min: 0, max: 100_000 }),
          y: num(rect, 'y', path, { min: 0, max: 100_000 }),
          width: num(rect, 'width', path, { min: 1, max: 100_000 }),
          height: num(rect, 'height', path, { min: 1, max: 100_000 }),
        },
        ...(f.required !== undefined ? { required: f.required } : {}),
        ...(label !== undefined ? { label } : {}),
      },
    };
  });
}

export interface EnvelopeSettings {
  title?: string;
  message?: string | null;
  changeNote?: string | null;
  routing?: RoutingMode;
  reminders?: ReminderPolicy;
  expiresAt?: string;
  metadata?: Record<string, string>;
}

export function parseSettings(body: Obj, now: Date, isCreate: boolean): EnvelopeSettings {
  const out: EnvelopeSettings = {};
  if (isCreate || body.title !== undefined) out.title = str(body, 'title', '', { max: 200 });
  if (body.message === null) out.message = null;
  else if (body.message !== undefined) out.message = str(body, 'message', '', { max: 5000 });
  if (body.changeNote === null) out.changeNote = null;
  else if (body.changeNote !== undefined) {
    out.changeNote = str(body, 'changeNote', '', { max: 2000 });
  }
  if (body.routing !== undefined || isCreate) {
    out.routing = oneOf(body, 'routing', '', ROUTING, 'sequential');
  }
  if (body.reminders !== undefined) {
    const r = parseJsonObject(body.reminders, 'reminders');
    out.reminders = {
      firstAfterDays: num(r, 'firstAfterDays', 'reminders.', { min: 0, max: 365, int: true }),
      everyDays: num(r, 'everyDays', 'reminders.', { min: 1, max: 365, int: true }),
      max: num(r, 'max', 'reminders.', { min: 0, max: 50, int: true }),
    };
  } else if (isCreate) {
    out.reminders = { ...DEFAULT_REMINDERS };
  }
  if (body.expiresAt !== undefined) {
    const value = str(body, 'expiresAt', '', { max: 40 });
    const at = new Date(value);
    if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) {
      throw validation('expiresAt must be a date and time in the future', { field: 'expiresAt' });
    }
    out.expiresAt = at.toISOString();
  } else if (body.expiresInDays !== undefined || isCreate) {
    const days =
      body.expiresInDays === undefined
        ? DEFAULT_EXPIRY_DAYS
        : num(body, 'expiresInDays', '', { min: 1, max: 365, int: true });
    out.expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
  }
  if (body.metadata !== undefined) {
    const m = parseJsonObject(body.metadata, 'metadata');
    const entries = Object.entries(m);
    if (entries.length > 50) throw validation('metadata can have at most 50 keys');
    out.metadata = {};
    for (const [k, v] of entries) {
      if (k.length > 100 || typeof v !== 'string' || v.length > 500) {
        throw validation(
          'metadata keys must be up to 100 characters and values strings up to 500',
          {
            field: `metadata.${k}`,
          },
        );
      }
      out.metadata[k] = v;
    }
  }
  return out;
}
