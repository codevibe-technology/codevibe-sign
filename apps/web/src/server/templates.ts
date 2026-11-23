import 'server-only';
import { createHash } from 'node:crypto';
import type { FileStore } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import { z } from 'zod';
import { MAX_DOCUMENTS } from '@/lib/send-flow';
import {
  ROLE_NAME_MAX,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_NAME_MAX,
  detailProblems,
  roleProblems,
  templateFieldProblems,
  type TemplateDefinition,
  type TemplateDocumentDef,
} from '@/lib/templates';
import { randomId, randomSecret } from './crypto';
import { AppError } from './errors';
import {
  assertRoom,
  assertWithin,
  countActiveTemplates,
  lockedPlan,
  reserveUsage,
  workspacePlan,
} from './plans';
import { userLabel } from './profile';

type Sql = postgres.Sql;

export interface TemplateRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  definition: TemplateDefinition;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

const fieldSchema = z.object({
  id: z.string().min(1).max(100),
  documentId: z.string().min(1).max(100),
  recipientId: z.string().min(1).max(100),
  type: z.enum(['signature', 'initials', 'date_signed', 'name', 'text', 'checkbox']),
  page: z.number().int().min(0).max(10_000),
  rect: z.object({
    x: z.number().min(0).max(100_000),
    y: z.number().min(0).max(100_000),
    width: z.number().min(1).max(100_000),
    height: z.number().min(1).max(100_000),
  }),
  required: z.boolean(),
  label: z.string().max(200).optional(),
});

/** What the editor sends; documents are described separately. */
export const definitionInputSchema = z.object({
  name: z.string().max(TEMPLATE_NAME_MAX * 2),
  description: z.string().max(TEMPLATE_DESCRIPTION_MAX * 2),
  title: z.string().max(400),
  message: z.string().max(10_000),
  routing: z.enum(['sequential', 'parallel']),
  expiresInDays: z.number().int(),
  remindEveryDays: z.number().int().min(0).max(30),
  roles: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().max(ROLE_NAME_MAX * 2),
        type: z.enum(['signer', 'approver', 'viewer']),
        auth: z.enum(['email_link', 'email_otp', 'sms_otp']),
      }),
    )
    .max(100),
  fields: z.array(fieldSchema).max(500),
});

export type DefinitionInput = z.infer<typeof definitionInputSchema>;

const firstProblem = (problems: Record<string, string>) => Object.entries(problems)[0];

/**
 * Checks a definition with the same rules the editor shows, plus that every field sits on a
 * page of one of the documents. Throws an `AppError` naming the first problem.
 */
export function checkDefinition(
  input: DefinitionInput,
  documents: TemplateDocumentDef[],
): { name: string; description: string | null; definition: TemplateDefinition } {
  const roles = input.roles.map((r) => ({ ...r, name: r.name.trim() }));
  const problem =
    firstProblem(roleProblems(roles)) ??
    firstProblem(templateFieldProblems(roles, input.fields)) ??
    firstProblem(
      detailProblems({
        name: input.name,
        description: input.description,
        settings: {
          title: input.title,
          message: input.message,
          expiresInDays: input.expiresInDays,
          remindEveryDays: input.remindEveryDays,
        },
      }),
    );
  if (problem) throw new AppError('VALIDATION', problem[1], problem[0]);

  const roleIds = new Set(roles.map((r) => r.id));
  const viewers = new Set(roles.filter((r) => r.type === 'viewer').map((r) => r.id));
  const pages = new Map(documents.map((d) => [d.id, d.pages]));
  for (const field of input.fields) {
    const page = pages.get(field.documentId)?.[field.page];
    if (!roleIds.has(field.recipientId) || viewers.has(field.recipientId) || !page) {
      throw new AppError(
        'VALIDATION',
        'A field points at a role or page that is gone. Open Fields and place it again.',
        'fields',
      );
    }
    const { x, y, width, height } = field.rect;
    if (x + width > page.width + 0.5 || y + height > page.height + 0.5) {
      throw new AppError(
        'VALIDATION',
        'A field sticks out of its page. Open Fields and move it inside.',
        'fields',
      );
    }
  }
  return {
    name: input.name.trim(),
    description: input.description.trim() || null,
    definition: {
      title: input.title.trim(),
      message: input.message.trim(),
      routing: input.routing,
      expiresInDays: input.expiresInDays,
      remindEveryDays: input.remindEveryDays,
      roles,
      documents,
      fields: input.fields,
    },
  };
}

const STAGED = /^staged\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]{43})\.pdf$/;

/** Where a template's PDF lives in the file store. */
export const templateFileKey = (workspaceId: string, templateId: string, documentId: string) =>
  `templates/${workspaceId}/${templateId}/${documentId}.pdf`;

/**
 * Keeps a checked PDF until the template that uses it is saved. The key names the workspace,
 * so another workspace cannot claim it.
 */
export async function stageDocument(files: FileStore, workspaceId: string, bytes: Uint8Array) {
  const key = `staged/${workspaceId}/${randomSecret()}.pdf`;
  await files.put(key, bytes, 'application/pdf');
  return key;
}

export interface StagedDocumentInput {
  id: string;
  name: string;
  stagedKey: string;
  pages: { width: number; height: number }[];
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function claimStaged(
  files: FileStore,
  workspaceId: string,
  templateId: string,
  docs: StagedDocumentInput[],
  inspect: (
    name: string,
    bytes: Uint8Array,
  ) => Promise<{ pages: { width: number; height: number }[] }>,
): Promise<TemplateDocumentDef[]> {
  if (docs.length === 0) throw new AppError('VALIDATION', 'Add at least one PDF.', 'documents');
  if (docs.length > MAX_DOCUMENTS) {
    throw new AppError(
      'VALIDATION',
      `A template holds up to ${MAX_DOCUMENTS} documents.`,
      'documents',
    );
  }
  if (new Set(docs.map((d) => d.id)).size !== docs.length) {
    throw new AppError('VALIDATION', 'Two documents have the same id.', 'documents');
  }
  const out: TemplateDocumentDef[] = [];
  for (const doc of docs) {
    const match = STAGED.exec(doc.stagedKey);
    const bytes = match?.[1] === workspaceId ? await files.get(doc.stagedKey) : null;
    if (!bytes) {
      throw new AppError(
        'VALIDATION',
        `${doc.name} has to be added again: the upload expired.`,
        'documents',
      );
    }
    const info = await inspect(doc.name, bytes);
    await files.put(templateFileKey(workspaceId, templateId, doc.id), bytes, 'application/pdf');
    out.push({
      id: doc.id,
      name: doc.name.slice(0, 200),
      size: bytes.length,
      sha256: sha256(bytes),
      pages: info.pages,
    });
  }
  await Promise.allSettled(docs.map((d) => files.delete(d.stagedKey)));
  return out;
}

const SELECT = (sql: Sql) => sql`
  select t.id, t.workspace_id as "workspaceId", t.name, t.description, t.definition,
    t.created_by as "createdBy", ${userLabel(sql)} as "createdByName", t.created_at as "createdAt",
    t.updated_at as "updatedAt", t.archived_at as "archivedAt"
  from app_templates t left join auth_users u on u.id = t.created_by`;

/** Refuses early, before any file is copied, when the plan has no room for another template. */
async function precheckRoom(sql: Sql, workspaceId: string) {
  const plan = await workspacePlan(sql, workspaceId);
  if (plan.accountId && plan.limits.activeTemplates !== null) {
    assertRoom(plan, 'activeTemplates', await countActiveTemplates(sql, plan.accountId));
  }
}

/**
 * Inserts a template under the plan: the count of active templates, the size of its PDFs and
 * the account's stored bytes are checked with the account locked, so they hold under
 * concurrent saves in any of its workspaces. The template's files are removed again when it is refused.
 */
export async function insertTemplate(
  sql: Sql,
  files: FileStore,
  row: {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    definition: TemplateDefinition;
    /** Null for a template created through the API with a key. */
    createdBy: string | null;
  },
) {
  const bytes = row.definition.documents.reduce((sum, d) => sum + d.size, 0);
  try {
    await sql.begin(async (tx) => {
      const plan = await lockedPlan(tx, row.workspaceId);
      if (plan) {
        assertRoom(plan, 'activeTemplates', await countActiveTemplates(tx, plan.accountId));
        assertWithin(plan, 'envelopeBytes', bytes, 'documents');
        await reserveUsage(tx, { id: row.workspaceId, ...plan }, 'storage_bytes', bytes);
      }
      await tx`insert into app_templates (id, workspace_id, name, description, definition, created_by)
        values (${row.id}, ${row.workspaceId}, ${row.name}, ${row.description},
          ${tx.json(row.definition as unknown as postgres.JSONValue)}, ${row.createdBy})`;
    });
  } catch (err) {
    await Promise.allSettled(
      row.definition.documents.map((d) =>
        files.delete(templateFileKey(row.workspaceId, row.id, d.id)),
      ),
    );
    throw err;
  }
}

export async function createTemplate(
  sql: Sql,
  files: FileStore,
  input: {
    workspaceId: string;
    createdBy: string;
    definition: DefinitionInput;
    documents: StagedDocumentInput[];
    inspect: (
      name: string,
      bytes: Uint8Array,
    ) => Promise<{ pages: { width: number; height: number }[] }>;
  },
): Promise<TemplateRecord> {
  const id = randomId('tpl');
  const pagesOnly: TemplateDocumentDef[] = input.documents.map((d) => ({
    id: d.id,
    name: d.name,
    size: 0,
    sha256: '',
    pages: d.pages,
  }));
  checkDefinition(input.definition, pagesOnly);
  await precheckRoom(sql, input.workspaceId);
  const documents = await claimStaged(files, input.workspaceId, id, input.documents, input.inspect);
  const checked = checkDefinition(input.definition, documents);
  await insertTemplate(sql, files, {
    id,
    workspaceId: input.workspaceId,
    name: checked.name,
    description: checked.description,
    definition: checked.definition,
    createdBy: input.createdBy,
  });
  return (await getTemplate(sql, input.workspaceId, id))!;
}

/** Changes everything but the documents, which stay as they were saved. */
export async function updateTemplate(
  sql: Sql,
  workspaceId: string,
  id: string,
  input: DefinitionInput,
): Promise<TemplateRecord> {
  const current = await requireTemplate(sql, workspaceId, id);
  if (current.archivedAt) {
    throw new AppError('CONFLICT', 'Restore the template before changing it.');
  }
  const checked = checkDefinition(input, current.definition.documents);
  await sql`update app_templates set name = ${checked.name}, description = ${checked.description},
      definition = ${sql.json(checked.definition as unknown as postgres.JSONValue)}, updated_at = now()
    where id = ${id} and workspace_id = ${workspaceId}`;
  return (await getTemplate(sql, workspaceId, id))!;
}

export async function getTemplate(
  sql: Sql,
  workspaceId: string,
  id: string,
): Promise<TemplateRecord | null> {
  const [row] = await sql<TemplateRecord[]>`${SELECT(sql)}
    where t.id = ${id} and t.workspace_id = ${workspaceId}`;
  return row ?? null;
}

export async function requireTemplate(sql: Sql, workspaceId: string, id: string) {
  const template = await getTemplate(sql, workspaceId, id);
  if (!template)
    throw new AppError('NOT_FOUND', 'That template no longer exists in this workspace.');
  return template;
}

export async function listTemplates(
  sql: Sql,
  workspaceId: string,
  options: { archived?: boolean; q?: string } = {},
): Promise<TemplateRecord[]> {
  const q = options.q?.trim();
  return sql<TemplateRecord[]>`${SELECT(sql)}
    where t.workspace_id = ${workspaceId}
      and ${options.archived ? sql`t.archived_at is not null` : sql`t.archived_at is null`}
      ${q ? sql`and (t.name ilike ${`%${q.replace(/[\\%_]/g, '\\$&')}%`})` : sql``}
    order by t.updated_at desc
    limit 200`;
}

export async function countTemplates(sql: Sql, workspaceId: string) {
  const [row] = await sql<{ active: number; archived: number }[]>`
    select count(*) filter (where archived_at is null)::int as active,
      count(*) filter (where archived_at is not null)::int as archived
    from app_templates where workspace_id = ${workspaceId}`;
  return row ?? { active: 0, archived: 0 };
}

export async function setTemplateArchived(
  sql: Sql,
  workspaceId: string,
  id: string,
  archived: boolean,
) {
  const changed = archived
    ? await flipArchived(sql, workspaceId, id, archived)
    : await sql.begin(async (tx) => {
        const plan = await lockedPlan(tx, workspaceId);
        if (plan) {
          assertRoom(plan, 'activeTemplates', await countActiveTemplates(tx, plan.accountId));
        }
        return flipArchived(tx, workspaceId, id, archived);
      });
  if (!changed) {
    await requireTemplate(sql, workspaceId, id);
    throw new AppError(
      'CONFLICT',
      archived ? 'That template is already archived.' : 'That template is not archived.',
    );
  }
}

async function flipArchived(
  sql: Sql | postgres.TransactionSql,
  workspaceId: string,
  id: string,
  archived: boolean,
): Promise<boolean> {
  const rows = await sql`update app_templates
    set archived_at = ${archived ? sql`now()` : null}, updated_at = now()
    where id = ${id} and workspace_id = ${workspaceId}
      and ${archived ? sql`archived_at is null` : sql`archived_at is not null`}
    returning id`;
  return rows.length > 0;
}

/** A copy named "<name> (copy)", with its own copies of the PDFs. */
export async function duplicateTemplate(
  sql: Sql,
  files: FileStore,
  input: { workspaceId: string; id: string; createdBy: string },
): Promise<TemplateRecord> {
  const source = await requireTemplate(sql, input.workspaceId, input.id);
  await precheckRoom(sql, input.workspaceId);
  const id = randomId('tpl');
  for (const doc of source.definition.documents) {
    const bytes = await files.get(templateFileKey(input.workspaceId, source.id, doc.id));
    if (!bytes)
      throw new AppError(
        'CONFLICT',
        `${doc.name} is missing from storage, so the template cannot be copied.`,
      );
    await files.put(templateFileKey(input.workspaceId, id, doc.id), bytes, 'application/pdf');
  }
  const name = `${source.name} (copy)`.slice(0, TEMPLATE_NAME_MAX);
  await insertTemplate(sql, files, {
    id,
    workspaceId: input.workspaceId,
    name,
    description: source.description,
    definition: source.definition,
    createdBy: input.createdBy,
  });
  return (await getTemplate(sql, input.workspaceId, id))!;
}

/** The template's PDF, or null when the document is not part of it. */
export async function readTemplateDocument(
  files: FileStore,
  template: TemplateRecord,
  documentId: string,
): Promise<Uint8Array | null> {
  if (!template.definition.documents.some((d) => d.id === documentId)) return null;
  return files.get(templateFileKey(template.workspaceId, template.id, documentId));
}
