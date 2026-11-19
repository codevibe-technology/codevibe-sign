import {
  isValidEmail,
  isValidPhone,
  SignError,
  type Envelope,
  type TransitionResult,
  type ValidationIssue,
} from '@codevibe_technology/sign-core';
import { parseCsv } from './csv';
import { buildEnvelope, type InstantiateDeps } from './instantiate';
import type { InstantiateInput, RoleAssignment, Template, TemplateRole } from './types';
import { assertValidTemplate, roleKey } from './validate';
import { templateVersion } from './version';

const ROLE_ATTRIBUTES = ['name', 'email', 'phone'] as const;
type RoleAttribute = (typeof ROLE_ATTRIBUTES)[number];

export type BulkColumn =
  | { header: string; kind: 'role'; role: string; attribute: RoleAttribute }
  | { header: string; kind: 'prefill'; label: string }
  | { header: string; kind: 'metadata'; key: string }
  | { header: string; kind: 'unknown' };

export interface BulkRow {
  /** One-based line in the CSV file. */
  line: number;
  /** Keyed by the template's role name. Only roles with at least one value in the row. */
  roles: Record<string, Partial<RoleAssignment>>;
  /** Keyed by the template's field label. Empty cells are left out. */
  prefill: Record<string, string>;
  metadata: Record<string, string>;
}

export interface BulkError {
  /** One-based line in the CSV file; 1 is the header. */
  line: number;
  /** The CSV column at fault, when there is one. */
  column?: string;
  /** Path of the problem in the envelope input, for errors found while planning. */
  path?: string;
  message: string;
}

export interface BulkParseResult {
  columns: BulkColumn[];
  /** Rows without errors, ready for `planBulkSend`. */
  rows: BulkRow[];
  errors: BulkError[];
}

export interface BulkPlanOptions {
  /** Applied to every row; row values win. Use it for roles that are the same for everyone, such as HR. */
  defaults?: Partial<InstantiateInput>;
}

export interface BulkPlan {
  envelopes: Envelope[];
  /** The same envelopes with their CSV line and the `envelope.created` result to commit. */
  planned: { line: number; result: TransitionResult }[];
  errors: BulkError[];
}

const normalize = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ');

const METADATA_HEADER = /^meta(?:data)?[\s._:-]+(.+)$/i;

function classify(header: string, template: Template): BulkColumn {
  const norm = normalize(header);
  for (const role of template.roles) {
    for (const attribute of ROLE_ATTRIBUTES) {
      if (norm === `${normalize(role.name)} ${attribute}`) {
        return { header, kind: 'role', role: role.name, attribute };
      }
    }
  }
  const field = template.roles
    .flatMap((r) => r.fields ?? [])
    .find((f) => f.type === 'text' && f.label && normalize(f.label) === norm);
  if (field) return { header, kind: 'prefill', label: field.label! };
  const meta = METADATA_HEADER.exec(header.trim());
  if (meta) return { header, kind: 'metadata', key: meta[1]!.trim() };
  return { header, kind: 'unknown' };
}

function columnId(column: BulkColumn): string {
  switch (column.kind) {
    case 'role':
      return `role:${roleKey(column.role)}:${column.attribute}`;
    case 'prefill':
      return `prefill:${normalize(column.label)}`;
    case 'metadata':
      return `metadata:${column.key}`;
    case 'unknown':
      return `unknown:${column.header}`;
  }
}

function headerErrors(columns: BulkColumn[]): BulkError[] {
  const errors: BulkError[] = [];
  const seen = new Set<string>();
  for (const column of columns) {
    if (!column.header.trim()) {
      errors.push({ line: 1, column: column.header, message: 'A column has no heading' });
      continue;
    }
    if (column.kind === 'unknown') {
      errors.push({
        line: 1,
        column: column.header,
        message: `Unknown column ${column.header}. Use "<Role> name", "<Role> email", "<Role> phone", a text field label or "meta.<key>"`,
      });
      continue;
    }
    const id = columnId(column);
    if (seen.has(id)) {
      errors.push({
        line: 1,
        column: column.header,
        message: `Column ${column.header} appears twice`,
      });
    }
    seen.add(id);
  }
  return errors;
}

function needsEmail(role: TemplateRole, person: Partial<RoleAssignment>): boolean {
  const auth = person.auth ?? role.auth;
  if (auth === 'email_link' || auth === 'email_otp') return true;
  return auth === undefined && !person.phone;
}

function personErrors(
  role: TemplateRole,
  person: Partial<RoleAssignment>,
  line: number,
  columnFor: (attribute: RoleAttribute) => string,
): BulkError[] {
  const errors: BulkError[] = [];
  const at = (attribute: RoleAttribute, message: string) =>
    errors.push({ line, column: columnFor(attribute), message });
  if (!person.name) at('name', `Missing ${role.name} name`);
  if (person.email && !isValidEmail(person.email)) {
    at('email', `${role.name} email ${person.email} is not a valid address`);
  } else if (!person.email && needsEmail(role, person)) {
    at('email', `Missing ${role.name} email`);
  }
  if (person.phone && !isValidPhone(person.phone)) {
    at('phone', `${role.name} phone must be in international format, for example +919876543210`);
  } else if (!person.phone && role.auth === 'sms_otp') {
    at('phone', `Missing ${role.name} phone; this role signs with an SMS code`);
  }
  return errors;
}

/**
 * Reads a bulk-send CSV for a template. The header names the columns:
 * `<Role> name`, `<Role> email`, `<Role> phone` (any case; spaces, dots, dashes or
 * underscores between words), the label of a text field to prefill, or `meta.<key>` for
 * envelope metadata. Never throws for bad data: every problem is listed with its line.
 */
export function parseBulkCsv(csvText: string, template: Template): BulkParseResult {
  const parsed = parseCsv(csvText);
  const errors: BulkError[] = parsed.error ? [{ ...parsed.error }] : [];
  const [header, ...body] = parsed.records;
  if (!header) {
    if (!parsed.error) errors.push({ line: 1, message: 'The file is empty; add a header row' });
    return { columns: [], rows: [], errors };
  }

  const columns = header.cells.map((cell) => classify(cell, template));
  errors.unshift(...headerErrors(columns));
  const rolesByKey = new Map(template.roles.map((r) => [roleKey(r.name), r]));
  const headerFor = (role: string, attribute: RoleAttribute) =>
    columns.find(
      (c) => c.kind === 'role' && roleKey(c.role) === roleKey(role) && c.attribute === attribute,
    )?.header ?? `${role} ${attribute}`;

  const rows: BulkRow[] = [];
  const seen = new Map<string, number>();
  for (const record of body) {
    const rowErrors: BulkError[] = [];
    const extra = record.cells.slice(columns.length).filter((c) => c.trim() !== '');
    if (extra.length > 0) {
      rowErrors.push({
        line: record.line,
        message: `Row has ${record.cells.length} values but the header has ${columns.length} columns`,
      });
    }

    const row: BulkRow = { line: record.line, roles: {}, prefill: {}, metadata: {} };
    columns.forEach((column, i) => {
      const value = (record.cells[i] ?? '').trim();
      if (!value) return;
      if (column.kind === 'role') {
        const person = (row.roles[column.role] ??= {});
        person[column.attribute] =
          column.attribute === 'phone' ? value.replace(/[\s-]/g, '') : value;
      } else if (column.kind === 'prefill') {
        row.prefill[column.label] = value;
      } else if (column.kind === 'metadata') {
        row.metadata[column.key] = value;
      }
    });

    for (const [name, person] of Object.entries(row.roles)) {
      const role = rolesByKey.get(roleKey(name))!;
      rowErrors.push(...personErrors(role, person, record.line, (a) => headerFor(name, a)));
    }

    const identity = Object.keys(row.roles)
      .sort()
      .map((name) => {
        const person = row.roles[name]!;
        return `${roleKey(name)}=${(person.email ?? person.phone ?? '').toLowerCase()}`;
      })
      .join('|');
    if (identity && rowErrors.length === 0) {
      const first = seen.get(identity);
      if (first !== undefined) {
        rowErrors.push({
          line: record.line,
          message: `Duplicate of line ${first}: the same people again`,
        });
      } else {
        seen.set(identity, record.line);
      }
    }

    if (rowErrors.length > 0) errors.push(...rowErrors);
    else rows.push(row);
  }
  return { columns, rows, errors };
}

function merge(
  defaults: Record<string, RoleAssignment> | undefined,
  row: Record<string, Partial<RoleAssignment>>,
): Record<string, RoleAssignment> {
  const merged = new Map<string, [string, Partial<RoleAssignment>]>();
  for (const [name, person] of Object.entries(defaults ?? {}))
    merged.set(roleKey(name), [name, person]);
  for (const [name, person] of Object.entries(row)) {
    const current = merged.get(roleKey(name))?.[1] ?? {};
    merged.set(roleKey(name), [name, { ...current, ...person }]);
  }
  return Object.fromEntries(
    [...merged.values()].map(([name, person]) => [name, { name: '', ...person }]),
  );
}

/**
 * Builds one draft envelope per row with `instantiate`'s rules. Rows that fail are reported in
 * `errors` with their line and the rest are still planned. Throws only when the template
 * itself is invalid.
 */
export async function planBulkSend(
  template: Template,
  rows: readonly BulkRow[],
  deps: InstantiateDeps,
  options: BulkPlanOptions = {},
): Promise<BulkPlan> {
  assertValidTemplate(template);
  const version = await templateVersion(template, deps.hasher);
  const defaults = options.defaults ?? {};
  const plan: BulkPlan = { envelopes: [], planned: [], errors: [] };

  const covered = new Set([
    ...Object.keys(defaults.roles ?? {}).map(roleKey),
    ...rows.flatMap((row) => Object.keys(row.roles).map(roleKey)),
  ]);
  const uncovered = template.roles.filter((r) => !covered.has(roleKey(r.name)));
  if (rows.length > 0 && uncovered.length > 0) {
    for (const role of uncovered) {
      plan.errors.push({
        line: 1,
        path: `roles.${role.name}`,
        message: `Nobody is given the ${role.name} role: add "${role.name} name" and "${role.name} email" columns or pass them in defaults`,
      });
    }
    return plan;
  }

  for (const row of rows) {
    const input: InstantiateInput = {
      roles: merge(defaults.roles, row.roles),
      prefill: { ...defaults.prefill, ...row.prefill },
      metadata: { ...defaults.metadata, ...row.metadata },
      ...(defaults.overrides && { overrides: defaults.overrides }),
    };
    try {
      const result = buildEnvelope(template, input, deps, version);
      plan.envelopes.push(result.envelope);
      plan.planned.push({ line: row.line, result });
    } catch (error) {
      if (!(error instanceof SignError && error.code === 'VALIDATION')) throw error;
      const issues = (error.details?.issues as ValidationIssue[] | undefined) ?? [];
      plan.errors.push(
        ...issues.map((issue) => ({ line: row.line, path: issue.path, message: issue.message })),
      );
    }
  }
  return plan;
}
