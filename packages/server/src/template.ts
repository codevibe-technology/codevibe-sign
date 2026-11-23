import {
  DEFAULT_REMINDERS,
  type AuthMethod,
  type FieldType,
  type Id,
  type IdGenerator,
  type IsoDateTime,
  type PageSize,
  type Rect,
  type RecipientRole,
  type ReminderPolicy,
  type RoutingMode,
} from '@codevibe_technology/sign-core';
import { validation } from './errors';
import {
  AUTH,
  DEFAULT_EXPIRY_DAYS,
  ROLES,
  ROUTING,
  list,
  num,
  oneOf,
  parseFields,
  parseJsonObject,
  parseReminders,
  str,
  type Obj,
} from './input';

export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_DESCRIPTION_MAX = 500;
export const ROLE_NAME_MAX = 60;
const MAX_ROLES = 50;
/** Field boxes may overhang their page by this much, to forgive rounding in editors. */
const PAGE_TOLERANCE = 0.5;

/** A slot that a person fills when an envelope is made, such as Employee or HR. */
export interface TemplateRole {
  id: Id;
  /** Unique within the template, ignoring case. */
  name: string;
  type: RecipientRole;
  auth: AuthMethod;
}

export interface TemplateDocument {
  id: Id;
  name: string;
  /** Size of the PDF in bytes. */
  size: number;
  /** SHA-256 of the PDF, lowercase hex. */
  sha256: string;
  pageCount: number;
  /** Page sizes in PDF points, in page order. */
  pages: PageSize[];
}

export interface TemplateField {
  id: Id;
  documentId: Id;
  /** The role whose person fills the field in. */
  roleId: Id;
  type: FieldType;
  /** Zero-based page index. */
  page: number;
  rect: Rect;
  required: boolean;
  label?: string;
}

/** Everything an envelope needs except the people: documents, roles, fields and settings. */
export interface Template {
  id: Id;
  name: string;
  description?: string;
  /** Title of the envelopes made from the template. */
  title: string;
  message?: string;
  routing: RoutingMode;
  reminders: ReminderPolicy;
  /** Envelopes expire this many days after they are created. */
  expiresInDays: number;
  roles: TemplateRole[];
  documents: TemplateDocument[];
  fields: TemplateField[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Where a template's PDF lives in the file store. Never built from request input alone. */
export const templateFileKey = (workspaceId: string, templateId: Id, documentId: Id) =>
  `templates/${workspaceId}/${templateId}/${documentId}.pdf`;

export interface TemplateSummary {
  id: Id;
  name: string;
  description: string | null;
  roles: { name: string; type: RecipientRole }[];
  documentCount: number;
  pageCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export function templateSummary(template: Template): TemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    roles: template.roles.map((r) => ({ name: r.name, type: r.type })),
    documentCount: template.documents.length,
    pageCount: template.documents.reduce((n, d) => n + d.pageCount, 0),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export const roleKey = (name: string) => name.trim().toLowerCase();

interface RoleSpec {
  /** How fields refer to this role in the same request. */
  key: string;
  role: TemplateRole;
}

function parseRoles(body: Obj, existing: TemplateRole[], ids: IdGenerator): RoleSpec[] {
  const known = new Map(existing.map((r) => [r.id, r]));
  const parsed = list(body, 'roles', { min: 1, max: MAX_ROLES }).map((raw, i): RoleSpec => {
    const path = `roles[${i}].`;
    const r = parseJsonObject(raw, `roles[${i}]`);
    const kept = typeof r.id === 'string' ? known.get(r.id) : undefined;
    const role: TemplateRole = {
      id: kept?.id ?? ids.id(),
      name: str(r, 'name', path, { max: ROLE_NAME_MAX }),
      type: oneOf(r, 'type', path, ROLES, 'signer'),
      auth: oneOf(r, 'auth', path, AUTH, 'email_otp'),
    };
    return {
      key: str(r, 'key', path, { max: 100, optional: true }) ?? kept?.id ?? String(i),
      role,
    };
  });
  if (new Set(parsed.map((p) => p.key)).size !== parsed.length) {
    throw validation('roles must have unique keys', { field: 'roles' });
  }
  const names = new Set<string>();
  parsed.forEach(({ role }, i) => {
    if (names.has(roleKey(role.name))) {
      throw validation(`roles[${i}].name is already the name of another role`, {
        field: `roles[${i}].name`,
      });
    }
    names.add(roleKey(role.name));
  });
  if (!parsed.some((p) => p.role.type !== 'viewer')) {
    throw validation('At least one role must be a signer or an approver', { field: 'roles' });
  }
  return parsed;
}

function placeFields(
  body: Obj,
  roles: RoleSpec[],
  documents: TemplateDocument[],
  documentKeys: Map<string, Id>,
  ids: IdGenerator,
): TemplateField[] {
  const byKey = new Map<string, TemplateRole>();
  for (const { key, role } of roles) {
    byKey.set(role.id, role);
    byKey.set(key, role);
  }
  return parseFields(body, 'role').map((spec, i) => {
    const prefix = `fields[${i}]`;
    const role = byKey.get(spec.recipient);
    if (!role) {
      throw validation(`${prefix}.role does not match any role`, { field: `${prefix}.role` });
    }
    if (role.type === 'viewer') {
      throw validation(`${prefix}.role is a viewer, and viewers fill in nothing`, {
        field: `${prefix}.role`,
      });
    }
    const documentId =
      spec.document !== undefined
        ? documentKeys.get(spec.document)
        : documents.length === 1
          ? documents[0]?.id
          : undefined;
    const document = documents.find((d) => d.id === documentId);
    if (!document) {
      throw validation(`${prefix}.document does not match any document`, {
        field: `${prefix}.document`,
      });
    }
    const page = document.pages[spec.input.page];
    if (!page) {
      throw validation(`${prefix}.page is not a page of ${document.name}`, {
        field: `${prefix}.page`,
      });
    }
    const { x, y, width, height } = spec.input.rect;
    if (x + width > page.width + PAGE_TOLERANCE || y + height > page.height + PAGE_TOLERANCE) {
      throw validation(`${prefix} does not fit inside its page`, { field: `${prefix}.rect` });
    }
    return {
      id: ids.id(),
      documentId: document.id,
      roleId: role.id,
      type: spec.input.type,
      page: spec.input.page,
      rect: spec.input.rect,
      required: spec.input.required ?? true,
      ...(spec.input.label !== undefined ? { label: spec.input.label } : {}),
    };
  });
}

function cleared(body: Obj, key: string, max: number): string | undefined {
  return body[key] === null ? undefined : str(body, key, '', { max, optional: true });
}

export interface NewTemplateParts {
  id: Id;
  documents: TemplateDocument[];
  /** Request key or id of each document, for fields to refer to. */
  documentKeys: Map<string, Id>;
}

/** A template from a create request whose documents were already checked. */
export function buildTemplate(
  body: Obj,
  parts: NewTemplateParts,
  deps: { ids: IdGenerator; now: Date },
): Template {
  const name = str(body, 'name', '', { max: TEMPLATE_NAME_MAX });
  const description = cleared(body, 'description', TEMPLATE_DESCRIPTION_MAX);
  const message = cleared(body, 'message', 5000);
  const roles = parseRoles(body, [], deps.ids);
  const at = deps.now.toISOString();
  return {
    id: parts.id,
    name,
    ...(description !== undefined ? { description } : {}),
    title: str(body, 'title', '', { max: 200, optional: true }) ?? name,
    ...(message !== undefined ? { message } : {}),
    routing: oneOf(body, 'routing', '', ROUTING, 'sequential'),
    reminders:
      body.reminders !== undefined ? parseReminders(body.reminders) : { ...DEFAULT_REMINDERS },
    expiresInDays:
      body.expiresInDays === undefined
        ? DEFAULT_EXPIRY_DAYS
        : num(body, 'expiresInDays', '', { min: 1, max: 365, int: true }),
    roles: roles.map((r) => r.role),
    documents: parts.documents,
    fields: placeFields(body, roles, parts.documents, parts.documentKeys, deps.ids),
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * The template after a `PATCH`. Roles and fields, when given, replace the existing ones; a
 * role sent with its `id` keeps it. Fields left as they are must still have their role.
 */
export function updateTemplate(
  current: Template,
  body: Obj,
  deps: { ids: IdGenerator; now: Date },
): Template {
  if (body.documents !== undefined) {
    throw validation('Documents cannot be changed; create a new template instead', {
      field: 'documents',
    });
  }
  const next: Template = { ...current };
  if (body.name !== undefined) next.name = str(body, 'name', '', { max: TEMPLATE_NAME_MAX });
  if (body.title !== undefined) next.title = str(body, 'title', '', { max: 200 });
  for (const [key, max] of [
    ['description', TEMPLATE_DESCRIPTION_MAX],
    ['message', 5000],
  ] as const) {
    if (body[key] === undefined) continue;
    const value = cleared(body, key, max);
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  if (body.routing !== undefined) next.routing = oneOf(body, 'routing', '', ROUTING, 'sequential');
  if (body.reminders !== undefined) next.reminders = parseReminders(body.reminders);
  if (body.expiresInDays !== undefined) {
    next.expiresInDays = num(body, 'expiresInDays', '', { min: 1, max: 365, int: true });
  }

  const roles =
    body.roles !== undefined
      ? parseRoles(body, current.roles, deps.ids)
      : current.roles.map((role) => ({ key: role.id, role }));
  next.roles = roles.map((r) => r.role);
  if (body.fields !== undefined) {
    const documentKeys = new Map<string, Id>();
    current.documents.forEach((d, i) => {
      documentKeys.set(String(i), d.id);
      documentKeys.set(d.id, d.id);
    });
    next.fields = placeFields(body, roles, current.documents, documentKeys, deps.ids);
  } else {
    const fillers = new Set(next.roles.filter((r) => r.type !== 'viewer').map((r) => r.id));
    if (current.fields.some((f) => !fillers.has(f.roleId))) {
      throw validation(
        'A field belongs to a role that is gone or is now a viewer; send fields with the roles',
        { field: 'fields' },
      );
    }
  }
  const at = deps.now.getTime();
  // The stored `updatedAt` guards concurrent saves, so every save must move it.
  next.updatedAt = new Date(Math.max(at, Date.parse(current.updatedAt) + 1)).toISOString();
  return next;
}
