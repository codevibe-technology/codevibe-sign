import 'server-only';
import type { FileStore } from '@codevibe_technology/sign-core';
import { HttpError, type Template, type TemplateStore } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import { settingsBody } from '@/lib/send-flow';
import { envelopeTitle, type RoleAuth, type TemplateDefinition } from '@/lib/templates';
import { AppError } from '../errors';
import { PlanLimitError, assertWithin, workspacePlan } from '../plans';
import { insertTemplate } from '../templates';

type Sql = postgres.Sql;

interface Row {
  id: string;
  name: string;
  description: string | null;
  definition: TemplateDefinition;
  created_at: Date;
  /** `created_at` to the microsecond, so paging by it never skips or repeats a row. */
  created_exact: string;
  updated_at: Date;
}

/** The dashboard's day count as the reminder policy envelopes take. */
const remindersOf = (definition: TemplateDefinition) =>
  definition.reminders ??
  settingsBody(
    { title: 'x', message: '', expiresInDays: 30, remindEveryDays: definition.remindEveryDays },
    'x',
  ).reminders;

/** A saved template as the sign API describes it. */
export function toApiTemplate(row: Row): Template {
  const { definition } = row;
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    title: envelopeTitle(row.name, definition),
    ...(definition.message.trim() ? { message: definition.message.trim() } : {}),
    routing: definition.routing,
    reminders: remindersOf(definition),
    expiresInDays: definition.expiresInDays,
    roles: definition.roles.map((r) => ({ id: r.id, name: r.name, type: r.type, auth: r.auth })),
    documents: definition.documents.map((d) => ({
      id: d.id,
      name: d.name,
      size: d.size,
      sha256: d.sha256,
      pageCount: d.pages.length,
      pages: d.pages,
    })),
    fields: definition.fields.map((f) => ({
      id: f.id,
      documentId: f.documentId,
      roleId: f.recipientId,
      type: f.type,
      page: f.page,
      rect: f.rect,
      required: f.required,
      ...(f.label ? { label: f.label } : {}),
    })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** A template from the sign API as the dashboard stores and edits it. */
export function toDefinition(template: Template): TemplateDefinition {
  const { reminders } = template;
  const off = reminders.firstAfterDays === 0 || reminders.max === 0;
  return {
    title: template.title === template.name ? '' : template.title,
    message: template.message ?? '',
    routing: template.routing,
    expiresInDays: template.expiresInDays,
    remindEveryDays: off ? 0 : Math.min(30, reminders.everyDays),
    reminders,
    roles: template.roles.map((r) => {
      if (r.auth === 'aadhaar') {
        throw new HttpError('VALIDATION', 'Aadhaar eSign is not available for templates here', {
          issues: [{ path: 'roles', message: 'Use email_link, email_otp or sms_otp' }],
        });
      }
      return { id: r.id, name: r.name, type: r.type, auth: r.auth satisfies RoleAuth };
    }),
    documents: template.documents.map((d) => ({
      id: d.id,
      name: d.name,
      size: d.size,
      sha256: d.sha256,
      pages: d.pages,
    })),
    fields: template.fields.map((f) => ({
      id: f.id,
      documentId: f.documentId,
      recipientId: f.roleId,
      type: f.type,
      page: f.page,
      rect: f.rect,
      required: f.required,
      ...(f.label ? { label: f.label } : {}),
    })),
  };
}

/** A plan limit as the sign API can answer it: refused, with the numbers in `details`. */
function refusal(err: unknown): unknown {
  if (err instanceof PlanLimitError) {
    return new HttpError('FORBIDDEN', err.message, err.toJSON().error.details);
  }
  if (err instanceof AppError) {
    return new HttpError(err.code === 'VALIDATION' ? 'VALIDATION' : 'CONFLICT', err.message);
  }
  return err;
}

const SELECT = (sql: Sql) => sql`
  select id, name, description, definition, created_at, updated_at,
    to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_exact
  from app_templates`;

/**
 * Lets the sign API's `/v1/templates` routes work on the templates of the dashboard, so an
 * API key and a member see the same ones. Archived templates do not exist for the API, and
 * a new template passes the workspace's plan like one saved from the editor.
 */
export function appTemplateStore(sql: Sql, files: FileStore): TemplateStore {
  return {
    async insert(workspaceId, template) {
      const definition = toDefinition(template);
      try {
        const plan = await workspacePlan(sql, workspaceId);
        template.documents.forEach((d, i) =>
          assertWithin(plan, 'fileBytes', d.size, `documents[${i}]`),
        );
        await insertTemplate(sql, files, {
          id: template.id,
          workspaceId,
          name: template.name,
          description: template.description ?? null,
          definition,
          createdBy: null,
        });
      } catch (err) {
        throw refusal(err);
      }
    },
    async get(workspaceId, id) {
      const [row] = await sql<Row[]>`${SELECT(sql)}
        where id = ${id} and workspace_id = ${workspaceId} and archived_at is null`;
      return row ? toApiTemplate(row) : null;
    },
    async list(workspaceId, query) {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const pattern = query.search ? `%${query.search.replace(/[\\%_]/g, '\\$&')}%` : null;
      const rows = await sql<Row[]>`${SELECT(sql)}
        where workspace_id = ${workspaceId} and archived_at is null
          ${pattern ? sql`and name ilike ${pattern}` : sql``}
          ${
            // As text first: sent as a timestamp, the driver would cut it to milliseconds.
            after
              ? sql`and (created_at, id) < (${after.createdAt}::text::timestamptz, ${after.id})`
              : sql``
          }
        order by created_at desc, id desc
        limit ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        templates: page.map(toApiTemplate),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.created_exact, last.id) : null,
      };
    },
    async replace(workspaceId, template, expectedUpdatedAt) {
      const definition = toDefinition(template);
      const rows = await sql`update app_templates
        set name = ${template.name}, description = ${template.description ?? null},
          definition = ${sql.json(definition as unknown as postgres.JSONValue)},
          updated_at = ${new Date(template.updatedAt)}
        where id = ${template.id} and workspace_id = ${workspaceId} and archived_at is null
          and date_trunc('milliseconds', updated_at) = ${new Date(expectedUpdatedAt)}
        returning id`;
      return rows.length > 0;
    },
    async remove(workspaceId, id) {
      const [busy] = await sql`select 1 from app_bulk_sends
        where template_id = ${id} and workspace_id = ${workspaceId} and status = 'sending' limit 1`;
      if (busy) {
        throw new HttpError('CONFLICT', 'A bulk send from this template is still running');
      }
      const rows = await sql`delete from app_templates
        where id = ${id} and workspace_id = ${workspaceId} and archived_at is null returning id`;
      return rows.length > 0;
    },
  };
}

const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');

function decodeCursor(value: string): { createdAt: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0]))
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to the refusal below.
  }
  throw new HttpError('VALIDATION', 'cursor is not valid', {
    issues: [{ path: 'cursor', message: 'Use the nextCursor of the previous page' }],
  });
}
