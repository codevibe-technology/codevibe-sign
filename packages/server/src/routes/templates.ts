import {
  SignError,
  prefillFields,
  type Envelope,
  type FieldValue,
  type Id,
} from '@codevibe_technology/sign-core';
import { Hono } from 'hono';
import { sha256Hex } from '../crypto';
import { HttpError, validation } from '../errors';
import { readJson } from '../http/body';
import { idempotency } from '../http/idempotency';
import { enforce } from '../http/rate-limit';
import {
  parseJsonObject,
  parseMetadata,
  parseRecipients,
  parseSettings,
  type FieldSpec,
  type Obj,
  type RecipientSpec,
} from '../input';
import type { Runtime } from '../runtime/context';
import type { TemplateListQuery, TemplateStore } from '../store/types';
import {
  buildTemplate,
  roleKey,
  templateFileKey,
  templateSummary,
  updateTemplate,
  type Template,
  type TemplateDocument,
} from '../template';
import { principalScope } from '../tenancy';
import { apiEnvelope } from '../views';
import { createEnvelopeFromParts } from './create';
import { checkPdf, readUploadBody, senderAuth, type SenderEnv } from './shared';

const MAX_PREFILL = 500;

const notFound = () => new HttpError('NOT_FOUND', 'Template not found');

function storeOf(rt: Runtime): TemplateStore {
  if (!rt.templateStore) {
    throw new SignError('INVALID_STATE', 'This server does not keep templates');
  }
  return rt.templateStore;
}

/** The template, if it belongs to the caller's workspace; otherwise it does not exist. */
async function requireTemplate(rt: Runtime, workspaceId: string, id: Id): Promise<Template> {
  const template = await storeOf(rt).get(workspaceId, id);
  if (!template) throw notFound();
  return template;
}

function parseListQuery(query: Record<string, string>): TemplateListQuery {
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw validation('limit must be a whole number from 1 to 100', { field: 'limit' });
  }
  const search = query.q?.trim().slice(0, 200);
  return {
    limit,
    ...(search ? { search } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}

/** Points a validation error raised under `from` at `to`, in its message and its issues. */
function repoint(err: unknown, from: string, to: string): unknown {
  if (!(err instanceof SignError) || err.code !== 'VALIDATION') return err;
  const swap = (text: string) => text.split(from).join(to);
  const issues = Array.isArray(err.details?.issues)
    ? (err.details.issues as { path?: string; message?: string }[]).map((issue) => ({
        ...issue,
        ...(issue.path !== undefined ? { path: swap(issue.path) } : {}),
        ...(issue.message !== undefined ? { message: swap(issue.message) } : {}),
      }))
    : undefined;
  return new SignError('VALIDATION', swap(err.message), {
    ...err.details,
    ...(issues ? { issues } : {}),
  });
}

/**
 * One recipient per role from the `roles` of a request, keyed by role id or name. Every
 * role needs a person, and the person is checked by the same rules as any recipient.
 */
function recipientsFor(template: Template, body: Obj): RecipientSpec[] {
  const given = parseJsonObject(body.roles ?? {}, 'roles');
  const byRole = new Map<Id, { key: string; person: Obj }>();
  for (const [key, value] of Object.entries(given)) {
    const role =
      template.roles.find((r) => r.id === key) ??
      template.roles.find((r) => roleKey(r.name) === roleKey(key));
    if (!role) {
      throw validation(`roles.${key} does not match any role of the template`, {
        field: `roles.${key}`,
      });
    }
    if (byRole.has(role.id)) {
      throw validation(`roles.${key} names a role that is given twice`, {
        field: `roles.${key}`,
      });
    }
    byRole.set(role.id, { key, person: parseJsonObject(value, `roles.${key}`) });
  }

  let order = 0;
  const keys: string[] = [];
  const raw = template.roles.map((role) => {
    const entry = byRole.get(role.id);
    if (!entry) {
      throw validation(`roles.${role.name} is required: say who the ${role.name} is`, {
        field: `roles.${role.name}`,
      });
    }
    keys.push(entry.key);
    if (role.type !== 'viewer') order++;
    const { person } = entry;
    return {
      key: role.id,
      name: person.name,
      ...(person.email !== undefined ? { email: person.email } : {}),
      ...(person.phone !== undefined ? { phone: person.phone } : {}),
      role: role.type,
      auth: person.auth ?? role.auth,
      ...(role.type === 'viewer' ? {} : { order: template.routing === 'parallel' ? 1 : order }),
    };
  });
  try {
    return parseRecipients({ recipients: raw }, []);
  } catch (err) {
    throw keys.reduce((e, key, i) => repoint(e, `recipients[${i}]`, `roles.${key}`), err);
  }
}

interface Prefill {
  key: string;
  value: string;
  /** Positions in `template.fields` of the fields this entry fills. */
  fields: number[];
}

function parsePrefill(template: Template, body: Obj): Prefill[] {
  if (body.prefill === undefined) return [];
  const entries = Object.entries(parseJsonObject(body.prefill, 'prefill'));
  if (entries.length > MAX_PREFILL) {
    throw validation(`prefill can have at most ${MAX_PREFILL} keys`, { field: 'prefill' });
  }
  return entries.map(([key, value]) => {
    if (typeof value !== 'string') {
      throw validation(`prefill.${key} must be a string`, { field: `prefill.${key}` });
    }
    const label = key.trim().toLowerCase();
    const fields = template.fields.flatMap((f, i) =>
      f.id === key || (f.label !== undefined && f.label.trim().toLowerCase() === label) ? [i] : [],
    );
    if (fields.length === 0) {
      throw validation(`prefill.${key} does not match the id or label of any field`, {
        field: `prefill.${key}`,
      });
    }
    return { key, value, fields };
  });
}

/** Sets the prefilled values on the draft, whose fields are in the template's order. */
function applyPrefill(draft: Envelope, prefill: Prefill[]): Envelope {
  let next = draft;
  for (const entry of prefill) {
    const values: FieldValue[] = entry.fields.flatMap((i) => {
      const field = draft.fields[i];
      return field ? [{ fieldId: field.id, value: entry.value }] : [];
    });
    try {
      next = prefillFields(next, values);
    } catch (err) {
      let pointed = err;
      for (const { fieldId } of values) {
        pointed = repoint(pointed, `values.${fieldId}`, `prefill.${entry.key}`);
      }
      throw pointed;
    }
  }
  return next;
}

async function templateFiles(rt: Runtime, workspaceId: string, template: Template) {
  return Promise.all(
    template.documents.map(async (document) => {
      const bytes = await rt.files.get(templateFileKey(workspaceId, template.id, document.id));
      if (!bytes || sha256Hex(bytes) !== document.sha256) {
        throw new SignError(
          'INVALID_STATE',
          `${document.name} is missing from storage; create the template again`,
          { document: document.id },
        );
      }
      return {
        upload: { key: document.id, name: document.name, bytes },
        info: { pageCount: document.pageCount, pages: document.pages },
      };
    }),
  );
}

export function templateRoutes(rt: Runtime) {
  const app = new Hono<SenderEnv>();

  app.use('*', senderAuth(rt, 'templates'));
  app.use(
    '*',
    idempotency(
      rt.store,
      (c) => principalScope(c.get('principal')),
      () => rt.clock.now(),
    ),
  );

  app.get('/', async (c) => {
    const page = await storeOf(rt).list(
      c.get('principal').workspaceId,
      parseListQuery(c.req.query()),
    );
    return c.json({ templates: page.templates.map(templateSummary), nextCursor: page.nextCursor });
  });

  app.post('/', async (c) => {
    const store = storeOf(rt);
    const now = rt.clock.now();
    const principal = c.get('principal');
    await enforce(
      rt.limiter,
      `templates:${principalScope(principal)}`,
      rt.limits.envelopesPerMinute,
      60_000,
      now,
    );
    const { body, documents: uploads } = await readUploadBody(c, rt, 'template');
    if (new Set(uploads.map((d) => d.key)).size !== uploads.length) {
      throw validation('documents must have unique keys');
    }
    const infos = await Promise.all(uploads.map((d) => checkPdf(rt, d)));
    const id = rt.ids.id();
    const documentKeys = new Map<string, Id>();
    const documents: TemplateDocument[] = uploads.map((upload, i) => {
      const info = infos[i]!;
      const documentId = rt.ids.id();
      documentKeys.set(upload.key, documentId);
      return {
        id: documentId,
        name: upload.name,
        size: upload.bytes.byteLength,
        sha256: sha256Hex(upload.bytes),
        pageCount: info.pageCount,
        pages: info.pages,
      };
    });
    const template = buildTemplate(body, { id, documents, documentKeys }, { ids: rt.ids, now });

    const keys = documents.map((d) => templateFileKey(principal.workspaceId, id, d.id));
    await Promise.all(
      uploads.map((upload, i) => rt.files.put(keys[i]!, upload.bytes, 'application/pdf')),
    );
    try {
      await store.insert(principal.workspaceId, template);
    } catch (err) {
      await Promise.allSettled(keys.map((key) => rt.files.delete(key)));
      throw err;
    }
    return c.json(template, 201);
  });

  app.get('/:templateId', async (c) =>
    c.json(await requireTemplate(rt, c.get('principal').workspaceId, c.req.param('templateId'))),
  );

  app.patch('/:templateId', async (c) => {
    const { workspaceId } = c.get('principal');
    const body = parseJsonObject(await readJson(c));
    // Another request may save between our read and write; the change is then applied once
    // more on top of what it saved.
    for (let attempt = 1; ; attempt++) {
      const current = await requireTemplate(rt, workspaceId, c.req.param('templateId'));
      const next = updateTemplate(current, body, { ids: rt.ids, now: rt.clock.now() });
      if (await storeOf(rt).replace(workspaceId, next, current.updatedAt)) return c.json(next);
      if (attempt >= 2) throw new HttpError('CONFLICT', 'The template changed, try again');
    }
  });

  app.delete('/:templateId', async (c) => {
    const { workspaceId } = c.get('principal');
    const template = await requireTemplate(rt, workspaceId, c.req.param('templateId'));
    if (!(await storeOf(rt).remove(workspaceId, template.id))) throw notFound();
    await Promise.allSettled(
      template.documents.map((d) =>
        rt.files.delete(templateFileKey(workspaceId, template.id, d.id)),
      ),
    );
    return c.json({ id: template.id, deleted: true });
  });

  app.post('/:templateId/envelopes', async (c) => {
    const now = rt.clock.now();
    const principal = c.get('principal');
    await enforce(
      rt.limiter,
      `envelopes:${principalScope(principal)}`,
      rt.limits.envelopesPerMinute,
      60_000,
      now,
    );
    const template = await requireTemplate(rt, principal.workspaceId, c.req.param('templateId'));
    const body = parseJsonObject(await readJson(c));
    if (body.send !== undefined && typeof body.send !== 'boolean') {
      throw validation('send must be true or false', { field: 'send' });
    }
    const metadata = body.metadata !== undefined ? parseMetadata(body.metadata) : {};
    const settings = parseSettings(
      {
        title: body.title ?? template.title,
        ...(body.message !== undefined
          ? { message: body.message }
          : template.message !== undefined
            ? { message: template.message }
            : {}),
        routing: template.routing,
        reminders: body.reminders ?? template.reminders,
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt }
          : { expiresInDays: body.expiresInDays ?? template.expiresInDays }),
        metadata: { ...metadata, templateId: template.id },
      },
      now,
      true,
    );
    const recipients = recipientsFor(template, body);
    const prefill = parsePrefill(template, body);
    const fields: FieldSpec[] = template.fields.map((f) => ({
      document: f.documentId,
      recipient: f.roleId,
      input: {
        type: f.type,
        page: f.page,
        rect: f.rect,
        required: f.required,
        ...(f.label !== undefined ? { label: f.label } : {}),
      },
    }));
    const envelope = await createEnvelopeFromParts(rt, principal.workspaceId, {
      settings,
      recipients,
      fields,
      documents: await templateFiles(rt, principal.workspaceId, template),
      send: body.send === true,
      prepare: (draft) => applyPrefill(draft, prefill),
    });
    return c.json(apiEnvelope(envelope), 201);
  });

  return app;
}
