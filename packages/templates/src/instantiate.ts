import {
  addDocument,
  addField,
  addRecipient,
  checkFieldValue,
  createEnvelope,
  SignError,
  validateForSend,
  type Clock,
  type Envelope,
  type FieldValue,
  type Hasher,
  type IdGenerator,
  type TransitionResult,
  type ValidationIssue,
} from '@codevibe/sign-core';
import type { InstantiateInput, RoleAssignment, Template } from './types';
import {
  assertValidTemplate,
  expiryDaysIssues,
  reminderIssues,
  roleKey,
  throwIf,
  validationError,
} from './validate';
import { resolveRoles, templateVersion } from './version';

const DAY_MS = 86_400_000;

/** Keys this package writes into `envelope.metadata`. */
export const METADATA_KEYS = {
  templateId: 'templateId',
  templateVersion: 'templateVersion',
  /** Comma-separated ids of fields the recipient may not change. */
  readOnlyFields: 'templateReadOnlyFields',
} as const;

export interface InstantiateDeps {
  clock: Clock;
  ids: IdGenerator;
  hasher: Hasher;
}

export const labelKey = (label: string): string => label.trim().toLowerCase();

function issuesOf(error: unknown): ValidationIssue[] | undefined {
  if (error instanceof SignError && error.code === 'VALIDATION') {
    return (error.details?.issues as ValidationIssue[] | undefined) ?? [];
  }
  return undefined;
}

/** Runs a core builder step and turns its validation errors into issues under `path`. */
function collect<T>(
  issues: ValidationIssue[],
  from: string,
  to: string,
  step: () => T,
): T | undefined {
  try {
    return step();
  } catch (error) {
    const found = issuesOf(error);
    if (!found) throw error;
    issues.push(
      ...found.map((issue) => ({
        ...issue,
        path: issue.path.startsWith(from) ? to + issue.path.slice(from.length) : issue.path,
      })),
    );
    return undefined;
  }
}

function inputIssues(template: Template, input: InstantiateInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const roleNames = new Set(template.roles.map((r) => roleKey(r.name)));
  const given = new Map(Object.entries(input.roles ?? {}).map(([k, v]) => [roleKey(k), v]));
  for (const role of template.roles) {
    if (!given.has(roleKey(role.name))) {
      issues.push({
        path: `roles.${role.name}`,
        message: `Choose someone for the ${role.name} role`,
      });
    }
  }
  for (const name of Object.keys(input.roles ?? {})) {
    if (!roleNames.has(roleKey(name))) {
      issues.push({ path: `roles.${name}`, message: `This template has no ${name} role` });
    }
  }

  const textFields = template.roles.flatMap((r) => r.fields ?? []).filter((f) => f.type === 'text');
  const labels = new Set(textFields.filter((f) => f.label).map((f) => labelKey(f.label!)));
  const prefill = new Map(Object.entries(input.prefill ?? {}).map(([k, v]) => [labelKey(k), v]));
  for (const [label, value] of Object.entries(input.prefill ?? {})) {
    if (!labels.has(labelKey(label))) {
      issues.push({ path: `prefill.${label}`, message: `No text field is labelled ${label}` });
      continue;
    }
    const checked = checkFieldValue('text', String(value));
    if (!checked.ok) issues.push({ path: `prefill.${label}`, message: checked.problem });
  }
  for (const field of textFields) {
    if (!field.readOnly || field.required === false) continue;
    if (!prefill.get(labelKey(field.label!))?.trim()) {
      issues.push({
        path: `prefill.${field.label}`,
        message: `Give a value for ${field.label}; recipients cannot fill it in`,
      });
    }
  }

  const overrides = input.overrides ?? {};
  if (overrides.reminders)
    issues.push(...reminderIssues(overrides.reminders, 'overrides.reminders'));
  issues.push(...expiryDaysIssues(overrides.expiresInDays, 'overrides.expiresInDays'));
  return issues;
}

function expiresAt(template: Template, input: InstantiateInput, now: Date): string | undefined {
  if (input.overrides?.expiresAt !== undefined) return input.overrides.expiresAt;
  const days = input.overrides?.expiresInDays ?? template.expiresInDays;
  return days === undefined ? undefined : new Date(now.getTime() + days * DAY_MS).toISOString();
}

/** Builds the draft for an already validated template; `version` is its `templateVersion`. */
export function buildEnvelope(
  template: Template,
  input: InstantiateInput,
  deps: { clock: Clock; ids: IdGenerator },
  version: string,
): TransitionResult {
  const issues = inputIssues(template, input);
  throwIf(issues);

  const now = deps.clock.now();
  const overrides = input.overrides ?? {};
  const message = overrides.message ?? template.message;
  const reminders = overrides.reminders ?? template.reminders;
  const expiry = expiresAt(template, input, now);
  const created = createEnvelope(
    {
      title: overrides.title ?? template.title,
      routing: overrides.routing ?? template.routing ?? 'sequential',
      ...(message !== undefined && { message }),
      ...(reminders !== undefined && { reminders }),
      ...(expiry !== undefined && { expiresAt: expiry }),
    },
    deps,
  );
  let envelope: Envelope = created.envelope;

  const documentIds = new Map<string, string>();
  for (const doc of template.documents) {
    const added = addDocument(
      envelope,
      {
        name: doc.name,
        sha256: doc.sha256,
        fileKey: doc.fileKey,
        pageCount: doc.pageSizes.length,
        pageSizes: doc.pageSizes,
      },
      deps,
    );
    envelope = added.envelope;
    documentIds.set(doc.fileKey, added.document.id);
  }

  const assignments = new Map<string, RoleAssignment>(
    Object.entries(input.roles).map(([k, v]) => [roleKey(k), v]),
  );
  const prefill = new Map(Object.entries(input.prefill ?? {}).map(([k, v]) => [labelKey(k), v]));
  const values: FieldValue[] = [];
  const readOnly: string[] = [];

  for (const role of resolveRoles(template.roles)) {
    const person = assignments.get(roleKey(role.name))!;
    const auth = person.auth ?? role.auth;
    const added = collect(issues, 'recipient', `roles.${role.name}`, () =>
      addRecipient(
        envelope,
        {
          name: person.name ?? '',
          role: role.type,
          order: role.order,
          ...(person.email !== undefined && { email: person.email }),
          ...(person.phone !== undefined && { phone: person.phone }),
          ...(auth !== undefined && { auth }),
        },
        deps,
      ),
    );
    if (!added) continue;
    envelope = added.envelope;

    for (const field of role.fields) {
      const value =
        field.type === 'text' && field.label ? prefill.get(labelKey(field.label)) : undefined;
      const prefilled = value !== undefined && value.trim() !== '';
      const locked = Boolean(field.readOnly) && prefilled;
      const placed = addField(
        envelope,
        {
          documentId: documentIds.get(field.document)!,
          recipientId: added.recipient.id,
          type: field.type,
          page: field.page,
          rect: field.rect,
          // Core only counts values submitted with the signature towards required fields,
          // so a locked, already filled field cannot also be required.
          required: locked ? false : (field.required ?? true),
          ...(field.label !== undefined && { label: field.label }),
        },
        deps,
      );
      envelope = placed.envelope;
      if (prefilled) values.push({ fieldId: placed.field.id, value: value.trim() });
      if (locked) readOnly.push(placed.field.id);
    }
  }
  throwIf(issues);

  envelope = {
    ...envelope,
    values,
    metadata: {
      ...template.metadata,
      ...input.metadata,
      ...(template.id !== undefined && { [METADATA_KEYS.templateId]: template.id }),
      [METADATA_KEYS.templateVersion]: version,
      ...(readOnly.length > 0 && { [METADATA_KEYS.readOnlyFields]: readOnly.join(',') }),
    },
  };
  const remaining = validateForSend(envelope, now);
  if (remaining.length > 0) throw validationError(remaining);
  return { ...created, envelope };
}

/**
 * Creates a draft envelope from a template, ready for core's `send`. Every core rule applies.
 * Returns core's `TransitionResult`, so the `envelope.created` event can be committed as usual.
 * Throws a `SignError` with code `VALIDATION` listing every problem in `details.issues`.
 */
export async function instantiate(
  template: Template,
  input: InstantiateInput,
  deps: InstantiateDeps,
): Promise<TransitionResult> {
  assertValidTemplate(template);
  const version = await templateVersion(template, deps.hasher);
  return buildEnvelope(template, input, deps, version);
}

/** Ids of the fields the recipient may not change (prefilled read-only fields). */
export function readOnlyFieldIds(envelope: Envelope): string[] {
  const raw = envelope.metadata?.[METADATA_KEYS.readOnlyFields];
  return raw ? raw.split(',').filter(Boolean) : [];
}

/**
 * Call before core's `submit`: rejects values aimed at read-only fields with
 * `INVALID_FIELD_VALUE`, the same code core uses for other bad values.
 */
export function assertWritable(envelope: Envelope, values: readonly FieldValue[]): void {
  const locked = new Set(readOnlyFieldIds(envelope));
  const blocked = values.filter((v) => locked.has(v.fieldId));
  if (blocked.length > 0) {
    throw new SignError('INVALID_FIELD_VALUE', 'This field is filled in by the sender', {
      fields: blocked.map((v) => ({ fieldId: v.fieldId, problem: 'Field is read-only' })),
    });
  }
}
