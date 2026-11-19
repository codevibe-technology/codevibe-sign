import { parseBulkCsv, parseCsv, type BulkError } from '@codevibe_technology/sign-templates';
import {
  emptyPerson,
  sendProblems,
  toSignTemplate,
  type People,
  type Person,
  type TemplateDefinition,
  type TemplateRoleDef,
} from './templates';

/** Most envelopes one bulk send may create. Larger lists are split into several files. */
export const MAX_BULK_ROWS = 500;
/** Largest CSV accepted, in bytes. */
export const MAX_BULK_CSV_BYTES = 1024 * 1024;

export interface BulkProblem {
  /** One-based line in the file; 1 is the header. */
  line: number;
  /** The column heading at fault, when there is one. */
  column?: string;
  message: string;
}

export interface BulkRowPlan {
  line: number;
  /** Keyed by role id; roles taken from `fixed` are included. */
  people: People;
  metadata: Record<string, string>;
}

export interface BulkPreview {
  /** Column headings in file order. */
  headers: string[];
  /** Every data row as read, for the preview table. */
  cells: { line: number; values: string[] }[];
  /** Roles that have no columns in the file and so need the same person for every row. */
  fixedRoles: TemplateRoleDef[];
  /** Rows without problems, ready to send. */
  ready: BulkRowPlan[];
  problems: BulkProblem[];
  /** Data rows in the file. */
  total: number;
  /** The file itself cannot be used (no header, too many rows, unknown columns). */
  blocking: boolean;
}

const roleKey = (name: string) => name.trim().toLowerCase();

/** A first file to fill in: one column per role detail, and one example row. */
export function sampleCsv(definition: TemplateDefinition): string {
  const headers: string[] = [];
  const example: string[] = [];
  definition.roles.forEach((role, i) => {
    headers.push(`${role.name} name`, `${role.name} email`);
    example.push(`Person ${i + 1}`, `person${i + 1}@example.com`);
    if (role.auth === 'sms_otp') {
      headers.push(`${role.name} phone`);
      example.push('+919812345678');
    }
  });
  headers.push('meta.reference');
  example.push('REF-001');
  const line = (cells: string[]) =>
    cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
  return `${line(headers)}\n${line(example)}\n`;
}

export const sampleCsvName = (templateName: string) =>
  `${
    templateName
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'template'
  }-bulk-send.csv`;

const fromBulkError = (e: BulkError): BulkProblem => ({
  line: e.line,
  ...(e.column ? { column: e.column } : {}),
  message: e.message,
});

/**
 * Reads a bulk-send CSV against a template: which roles come from the file, which need one
 * fixed person, and every problem with its line and column. Never throws for bad data.
 */
export function previewBulkCsv(
  text: string,
  template: { id: string; name: string },
  definition: TemplateDefinition,
  fixed: People = {},
): BulkPreview {
  const parsed = parseBulkCsv(text, toSignTemplate(template, definition));
  const headers = parsed.columns.map((c) => c.header);
  const problems: BulkProblem[] = parsed.errors.map(fromBulkError);

  for (const column of parsed.columns) {
    if (column.kind === 'prefill') {
      problems.unshift({
        line: 1,
        column: column.header,
        message: `Filling in "${column.label}" from the file is not available yet. Remove the column; the signer fills it in.`,
      });
    }
  }

  const covered = new Set(
    parsed.columns.flatMap((c) => (c.kind === 'role' ? [roleKey(c.role)] : [])),
  );
  const fixedRoles = definition.roles.filter((r) => !covered.has(roleKey(r.name)));
  const cells = parseCsv(text)
    .records.slice(1)
    .map((r) => ({ line: r.line, values: r.cells }));
  const total = cells.length;
  if (total > MAX_BULK_ROWS) {
    problems.unshift({
      line: 1,
      message: `The file has ${total} rows; one bulk send takes up to ${MAX_BULK_ROWS}. Split it into smaller files.`,
    });
  }
  if (headers.length > 0 && total === 0) {
    problems.push({
      line: 2,
      message: 'The file has a header but no rows. Add one row per envelope.',
    });
  }

  const byRole = new Map(definition.roles.map((r) => [roleKey(r.name), r]));
  const columnFor = (role: TemplateRoleDef, attribute: 'name' | 'email' | 'phone') =>
    parsed.columns.find(
      (c) =>
        c.kind === 'role' && roleKey(c.role) === roleKey(role.name) && c.attribute === attribute,
    )?.header ?? `${role.name} ${attribute}`;

  const ready: BulkRowPlan[] = [];
  for (const row of parsed.rows) {
    const people: People = {};
    const rowProblems: BulkProblem[] = [];
    for (const role of definition.roles) {
      if (!covered.has(roleKey(role.name))) {
        people[role.id] = fixed[role.id] ?? emptyPerson();
        continue;
      }
      const found = Object.entries(row.roles).find(([name]) => byRole.get(roleKey(name)) === role);
      if (!found) {
        rowProblems.push({
          line: row.line,
          column: columnFor(role, 'name'),
          message: `Missing ${role.name} name and email`,
        });
        continue;
      }
      const person: Person = {
        name: found[1].name ?? '',
        email: found[1].email ?? '',
        phone: found[1].phone ?? '',
      };
      if (role.auth === 'sms_otp' && !person.phone) {
        rowProblems.push({
          line: row.line,
          column: columnFor(role, 'phone'),
          message: `Missing ${role.name} phone; this role signs with an SMS code`,
        });
      }
      people[role.id] = person;
    }
    if (rowProblems.length === 0) {
      const sameTwice = Object.entries(
        sendProblems(
          { roles: definition.roles.filter((r) => covered.has(roleKey(r.name))) },
          people,
        ),
      ).find(([k]) => k.endsWith('.email'));
      if (sameTwice) {
        const roleId = sameTwice[0].split('.')[1]!;
        const role = definition.roles.find((r) => r.id === roleId)!;
        rowProblems.push({
          line: row.line,
          column: columnFor(role, 'email'),
          message: sameTwice[1],
        });
      }
    }
    if (rowProblems.length > 0) problems.push(...rowProblems);
    else ready.push({ line: row.line, people, metadata: row.metadata });
  }

  problems.sort((a, b) => a.line - b.line);
  const blocking =
    headers.length === 0 ||
    total === 0 ||
    total > MAX_BULK_ROWS ||
    problems.some((p) => p.line === 1);
  return {
    headers,
    cells,
    fixedRoles,
    ready,
    problems,
    total,
    blocking,
  };
}

/** Problems with the fixed people, keyed `people.<roleId>.<attribute>`. */
export const fixedPeopleProblems = (fixedRoles: TemplateRoleDef[], fixed: People) =>
  sendProblems({ roles: fixedRoles }, fixed);
