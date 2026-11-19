import { checkFieldValue, type Field, type FieldValue, type Recipient } from '@codevibe/sign-core';

export type FieldValues = Record<string, string>;

export type FieldStatus = 'empty' | 'filled' | 'invalid';

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase())
    .slice(0, 3)
    .join('');
}

export function hasValue(field: Field, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (field.type === 'checkbox') return value === 'true';
  return value.trim().length > 0;
}

/** Why a present value would be refused by core, or null when it is fine. */
export function valueProblem(field: Field, value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  const check = checkFieldValue(field.type, value);
  return check.ok ? null : check.problem;
}

export function fieldStatus(
  field: Field,
  value: string | undefined,
  showErrors: boolean,
): FieldStatus {
  if (valueProblem(field, value)) return 'invalid';
  if (hasValue(field, value)) return 'filled';
  return showErrors && field.required ? 'invalid' : 'empty';
}

export interface ValidationResult {
  valid: boolean;
  /** Required fields with no value. */
  missing: string[];
  /** Fields whose value has the wrong shape. */
  invalid: string[];
}

export function validateFieldValues(fields: Field[], values: FieldValues): ValidationResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const field of fields) {
    const value = values[field.id];
    if (valueProblem(field, value)) invalid.push(field.id);
    else if (field.required && !hasValue(field, value)) missing.push(field.id);
  }
  return { valid: missing.length === 0 && invalid.length === 0, missing, invalid };
}

/** Reading order: document, then page, then top to bottom, then left to right. */
export function sortFields(fields: Field[], documentOrder: string[] = []): Field[] {
  const docIndex = (id: string) => {
    const i = documentOrder.indexOf(id);
    return i < 0 ? documentOrder.length : i;
  };
  return [...fields].sort(
    (a, b) =>
      docIndex(a.documentId) - docIndex(b.documentId) ||
      a.page - b.page ||
      Math.round(a.rect.y) - Math.round(b.rect.y) ||
      a.rect.x - b.rect.x,
  );
}

/** Values a recipient starts with: today's date in date fields and their name in name fields. */
export function prefillValues(
  fields: Field[],
  recipient: Pick<Recipient, 'name'>,
  today: Date,
): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    if (field.type === 'date_signed') values[field.id] = isoDate(today);
    else if (field.type === 'name') values[field.id] = recipient.name;
    else if (field.type === 'checkbox') values[field.id] = 'false';
  }
  return values;
}

/**
 * The payload for submission: one entry per field that has a value, in reading
 * order. Checkboxes always report 'true' or 'false'; empty optional fields are left out.
 */
export function toFieldValues(fields: Field[], values: FieldValues): FieldValue[] {
  const result: FieldValue[] = [];
  for (const field of fields) {
    const value = values[field.id];
    if (field.type === 'checkbox') {
      result.push({ fieldId: field.id, value: value === 'true' ? 'true' : 'false' });
    } else if (value !== undefined && value.trim() !== '') {
      result.push({ fieldId: field.id, value: field.type === 'text' ? value : value.trim() });
    }
  }
  return result;
}
