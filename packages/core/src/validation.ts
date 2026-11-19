import { fromBase64 } from './internal/bytes';
import type { Field, FieldType, PageSize, Recipient, Rect, ReminderPolicy } from './types';
import { SignError } from './types';

export const MAX_IMAGE_BYTES = 512 * 1024;
/** Largest width or height, in pixels, of a signature or initials image. */
export const MAX_IMAGE_DIMENSION = 2048;
export const MAX_TEXT_LENGTH = 1000;
export const MAX_NAME_LENGTH = 200;
export const MAX_REASON_LENGTH = 1000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];

export interface ValidationIssue {
  /** Where the problem is, for example `recipients.r1.email` or `fields.f2.rect`. */
  path: string;
  message: string;
}

export function validationError(issues: ValidationIssue[]): SignError {
  const first = issues[0];
  const message = first ? `${first.message} (${first.path})` : 'Invalid input';
  return new SignError('VALIDATION', message, { issues });
}

export function fail(path: string, message: string): never {
  throw validationError([{ path, message }]);
}

export function isValidEmail(email: string): boolean {
  return (
    email.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
      email,
    ) &&
    !email.split('@')[0]!.startsWith('.') &&
    !email.split('@')[0]!.endsWith('.') &&
    !email.includes('..')
  );
}

/** E.164: a plus sign, a country code and up to 15 digits in total. */
export function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function recipientIssues(recipient: Recipient, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = recipient.name.trim();
  if (!name) issues.push({ path: `${path}.name`, message: 'Name is required' });
  if (name.length > MAX_NAME_LENGTH) {
    issues.push({
      path: `${path}.name`,
      message: `Name is longer than ${MAX_NAME_LENGTH} characters`,
    });
  }
  if (recipient.email !== undefined && !isValidEmail(recipient.email)) {
    issues.push({ path: `${path}.email`, message: 'Email address is not valid' });
  }
  if (recipient.phone !== undefined && !isValidPhone(recipient.phone)) {
    issues.push({
      path: `${path}.phone`,
      message: 'Phone number must be in international format, for example +919876543210',
    });
  }
  if (!recipient.email && !recipient.phone) {
    issues.push({ path: `${path}.email`, message: 'An email address or phone number is required' });
  }
  if ((recipient.auth === 'email_link' || recipient.auth === 'email_otp') && !recipient.email) {
    issues.push({ path: `${path}.email`, message: `Email is required for ${recipient.auth}` });
  }
  if (recipient.auth === 'sms_otp' && !recipient.phone) {
    issues.push({ path: `${path}.phone`, message: 'Phone number is required for sms_otp' });
  }
  if (!isPositiveInteger(recipient.order)) {
    issues.push({ path: `${path}.order`, message: 'Order must be a whole number of at least 1' });
  }
  return issues;
}

export function reminderIssues(policy: ReminderPolicy, path = 'reminders'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const wholeDays = (n: number) => Number.isInteger(n) && n >= 0;
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

export function rectIssues(
  rect: Rect,
  page: PageSize | undefined,
  path: string,
): ValidationIssue[] {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isFinite)) {
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

export function pageSizeIssues(
  sizes: PageSize[],
  pageCount: number,
  path: string,
): ValidationIssue[] {
  if (sizes.length !== pageCount) {
    return [{ path, message: `Expected ${pageCount} page sizes, got ${sizes.length}` }];
  }
  const bad = sizes.findIndex(
    (s) => !Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width <= 0 || s.height <= 0,
  );
  return bad === -1
    ? []
    : [{ path: `${path}.${bad}`, message: 'Page width and height must be greater than 0' }];
}

/** Decodes a PNG given as base64 or a `data:image/png;base64,` URL. Returns the bare base64. */
export function normalizePng(value: string): { base64: string } | { problem: string } {
  const base64 = value.replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '');
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    return { problem: `Image is larger than ${MAX_IMAGE_BYTES / 1024} KB` };
  }
  const bytes = fromBase64(base64);
  if (!bytes) return { problem: 'Image is not valid base64' };
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { problem: `Image is larger than ${MAX_IMAGE_BYTES / 1024} KB` };
  }
  const header = [...PNG_SIGNATURE, 0, 0, 0, 13, ...IHDR];
  if (bytes.length < 33 || header.some((byte, i) => bytes[i] !== byte)) {
    return { problem: 'Image is not a PNG' };
  }
  // A few hundred bytes of PNG can declare a huge canvas that decodes to gigabytes, so the
  // declared size is capped here, before anything downstream decodes the image.
  const ihdr = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return {
      problem: `Image is larger than ${MAX_IMAGE_DIMENSION} x ${MAX_IMAGE_DIMENSION} pixels`,
    };
  }
  return { base64 };
}

/** Accepts `YYYY-MM-DD` or a full ISO date-time, and only real calendar dates. */
export function isIsoDate(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    !Number.isNaN(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value))
  );
}

export type ValueCheck = { ok: true; value: string } | { ok: false; problem: string };

/** Checks one submitted value against its field type and returns it in stored form. */
export function checkFieldValue(type: FieldType, raw: string): ValueCheck {
  switch (type) {
    case 'signature':
    case 'initials': {
      const png = normalizePng(raw);
      return 'problem' in png
        ? { ok: false, problem: png.problem }
        : { ok: true, value: png.base64 };
    }
    case 'date_signed':
      return isIsoDate(raw)
        ? { ok: true, value: raw }
        : { ok: false, problem: 'Date must be an ISO date' };
    case 'checkbox':
      return raw === 'true' || raw === 'false'
        ? { ok: true, value: raw }
        : { ok: false, problem: "Checkbox value must be 'true' or 'false'" };
    case 'name':
    case 'text': {
      const max = type === 'name' ? MAX_NAME_LENGTH : MAX_TEXT_LENGTH;
      const value = raw.trim();
      return value.length > max
        ? { ok: false, problem: `Text is longer than ${max} characters` }
        : { ok: true, value };
    }
  }
}

/** A required field counts as filled only with a non-empty value (and a ticked box). */
export function isFilled(field: Field, value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  return field.type !== 'checkbox' || value === 'true';
}
