import {
  isValidEmail,
  isValidPhone,
  type AuthMethod,
  type Field,
  type PageSize,
  type RecipientRole,
  type RoutingMode,
} from '@codevibe_technology/sign-core';
import type { Template as SignTemplate } from '@codevibe_technology/sign-templates';
import {
  MAX_DOCUMENTS,
  MAX_RECIPIENTS,
  MESSAGE_MAX,
  TITLE_MAX,
  documentProblems,
  fieldProblems,
  localId,
  settingsBody,
  settingsProblems,
  type DraftDocument,
  type DraftRecipient,
  type DraftSettings,
  type Problems,
} from './send-flow';

export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_DESCRIPTION_MAX = 500;
export const ROLE_NAME_MAX = 60;

export type RoleAuth = Exclude<AuthMethod, 'aadhaar'>;

/** A slot in the template that a person fills when it is sent, such as Employee or HR. */
export interface TemplateRoleDef {
  id: string;
  name: string;
  type: RecipientRole;
  auth: RoleAuth;
}

export interface TemplateDocumentDef {
  id: string;
  name: string;
  size: number;
  sha256: string;
  pages: PageSize[];
}

/** What is stored for a template: everything an envelope needs except the people. */
export interface TemplateDefinition {
  title: string;
  message: string;
  routing: RoutingMode;
  expiresInDays: number;
  remindEveryDays: number;
  roles: TemplateRoleDef[];
  documents: TemplateDocumentDef[];
  /** `recipientId` is a role id; `documentId` a document id. */
  fields: Field[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  roles: { name: string; type: RecipientRole }[];
  documentCount: number;
  pageCount: number;
  updatedAt: string;
  archivedAt: string | null;
  createdByName: string | null;
}

export const STEPS = [
  { key: 'documents', label: 'Documents' },
  { key: 'roles', label: 'Roles' },
  { key: 'fields', label: 'Fields' },
  { key: 'details', label: 'Details' },
] as const;

export type TemplateStep = (typeof STEPS)[number]['key'];

export interface TemplateEditorState {
  templateId: string | null;
  name: string;
  description: string;
  documents: DraftDocument[];
  roles: TemplateRoleDef[];
  routing: RoutingMode;
  fields: Field[];
  settings: DraftSettings;
}

export const newRole = (name = ''): TemplateRoleDef => ({
  id: localId('role'),
  name,
  type: 'signer',
  auth: 'email_link',
});

export const emptyTemplate = (): TemplateEditorState => ({
  templateId: null,
  name: '',
  description: '',
  documents: [],
  roles: [newRole('Signer')],
  routing: 'sequential',
  fields: [],
  settings: { title: '', message: '', expiresInDays: 30, remindEveryDays: 2 },
});

/** Roles shaped like recipients, so the field placer and its checks can be reused. */
export const rolesAsRecipients = (roles: TemplateRoleDef[]): DraftRecipient[] =>
  roles.map((r) => ({
    id: r.id,
    saved: true,
    name: r.name,
    email: '',
    phone: '',
    role: r.type,
    auth: r.auth,
  }));

const key = (name: string) => name.trim().toLowerCase();

export function roleProblems(roles: TemplateRoleDef[]): Problems {
  const problems: Problems = {};
  if (roles.length === 0) {
    problems.roles = 'Add at least one role, for example Employee.';
    return problems;
  }
  if (roles.length > MAX_RECIPIENTS) {
    problems.roles = `A template can have at most ${MAX_RECIPIENTS} roles.`;
  }
  if (!roles.some((r) => r.type !== 'viewer')) {
    problems.roles = 'Make at least one role a signer or an approver.';
  }
  const seen = new Set<string>();
  for (const r of roles) {
    const at = `roles.${r.id}.name`;
    const name = key(r.name);
    if (!name) problems[at] = 'Name the role, for example Employee or Manager.';
    else if (r.name.trim().length > ROLE_NAME_MAX) {
      problems[at] = `Keep the role name under ${ROLE_NAME_MAX} characters.`;
    } else if (seen.has(name)) problems[at] = 'Another role already has this name.';
    seen.add(name);
  }
  return problems;
}

export function templateFieldProblems(roles: TemplateRoleDef[], fields: Field[]): Problems {
  return fieldProblems(rolesAsRecipients(roles), fields);
}

export function detailProblems(
  state: Pick<TemplateEditorState, 'name' | 'description' | 'settings'>,
): Problems {
  const problems: Problems = {};
  const name = state.name.trim();
  if (!name) problems.name = 'Name the template so people can find it, for example Offer letter.';
  else if (name.length > TEMPLATE_NAME_MAX) {
    problems.name = `Keep the name under ${TEMPLATE_NAME_MAX} characters.`;
  }
  if (state.description.trim().length > TEMPLATE_DESCRIPTION_MAX) {
    problems.description = `Keep the description under ${TEMPLATE_DESCRIPTION_MAX} characters.`;
  }
  const settings = settingsProblems({
    ...state.settings,
    title: state.settings.title.trim() || name || 'Untitled',
  });
  return { ...problems, ...settings };
}

export function templateStepProblems(step: TemplateStep, state: TemplateEditorState): Problems {
  switch (step) {
    case 'documents':
      return documentProblems(state.documents);
    case 'roles':
      return roleProblems(state.roles);
    case 'fields':
      return templateFieldProblems(state.roles, state.fields);
    case 'details':
      return {
        ...documentProblems(state.documents),
        ...roleProblems(state.roles),
        ...templateFieldProblems(state.roles, state.fields),
        ...detailProblems(state),
      };
  }
}

/** The first step that still needs something, or the last one. */
export function firstOpenStep(state: TemplateEditorState): TemplateStep {
  for (const { key: step } of STEPS) {
    if (Object.keys(templateStepProblems(step, state)).length > 0) return step;
  }
  return 'details';
}

/** Fields that still belong to a role that can have them, on a document that exists. */
export function keptFields(state: Pick<TemplateEditorState, 'roles' | 'fields' | 'documents'>) {
  const roles = new Set(state.roles.filter((r) => r.type !== 'viewer').map((r) => r.id));
  const documents = new Set(state.documents.map((d) => d.id));
  return state.fields.filter((f) => roles.has(f.recipientId) && documents.has(f.documentId));
}

/** The definition the editor saves; documents are described by the server. */
export function definitionInput(state: TemplateEditorState) {
  return {
    name: state.name.trim(),
    description: state.description.trim(),
    title: state.settings.title.trim(),
    message: state.settings.message.trim(),
    routing: state.routing,
    expiresInDays: state.settings.expiresInDays,
    remindEveryDays: state.settings.remindEveryDays,
    roles: state.roles.map((r) => ({ ...r, name: r.name.trim() })),
    fields: keptFields(state).map((f) => ({
      id: f.id,
      documentId: f.documentId,
      recipientId: f.recipientId,
      type: f.type,
      page: f.page,
      rect: f.rect,
      required: f.required,
      ...(f.label ? { label: f.label } : {}),
    })),
  };
}

export type DefinitionInput = ReturnType<typeof definitionInput>;

/** The editor's state for a saved template. */
export function editorStateFrom(
  template: { id: string; name: string; description: string | null },
  definition: TemplateDefinition,
): TemplateEditorState {
  return {
    templateId: template.id,
    name: template.name,
    description: template.description ?? '',
    documents: definition.documents.map((d) => ({
      id: d.id,
      name: d.name,
      size: d.size,
      pages: d.pages,
    })),
    roles: definition.roles,
    routing: definition.routing,
    fields: definition.fields,
    settings: {
      title: definition.title,
      message: definition.message,
      expiresInDays: definition.expiresInDays,
      remindEveryDays: definition.remindEveryDays,
    },
  };
}

export const envelopeTitle = (name: string, definition: TemplateDefinition) =>
  (definition.title.trim() || name).slice(0, TITLE_MAX);

/** One person for each role when sending, keyed by role id. */
export interface Person {
  name: string;
  email: string;
  phone: string;
}

export type People = Record<string, Person>;

export const emptyPerson = (): Person => ({ name: '', email: '', phone: '' });

const cleanPhone = (phone: string) => phone.replace(/[\s()-]/g, '');

/** Problems keyed `people.<roleId>.<name|email|phone>`, plus `title` and `message`. */
export function sendProblems(
  definition: Pick<TemplateDefinition, 'roles'>,
  people: People,
  overrides: { title: string; message: string } = { title: 'x', message: '' },
): Problems {
  const problems: Problems = {};
  const seen = new Map<string, string>();
  for (const role of definition.roles) {
    const person = people[role.id] ?? emptyPerson();
    const at = `people.${role.id}`;
    const name = person.name.trim();
    if (!name) problems[`${at}.name`] = `Enter the ${role.name}'s name.`;
    else if (name.length > 200) problems[`${at}.name`] = 'Keep the name under 200 characters.';
    const email = person.email.trim().toLowerCase();
    if (!email) problems[`${at}.email`] = `Enter the ${role.name}'s email; the link goes there.`;
    else if (!isValidEmail(email))
      problems[`${at}.email`] = 'This email address does not look right.';
    else {
      const same = seen.get(`${email}:${role.type}`);
      if (same) problems[`${at}.email`] = `This person is already the ${same} with the same part.`;
      seen.set(`${email}:${role.type}`, role.name);
    }
    const phone = cleanPhone(person.phone);
    if (role.auth === 'sms_otp' && !phone) {
      problems[`${at}.phone`] = `Enter the ${role.name}'s mobile number for the SMS code.`;
    } else if (phone && !isValidPhone(phone)) {
      problems[`${at}.phone`] = 'Use the international format, for example +919812345678.';
    }
  }
  if (!overrides.title.trim()) problems.title = 'Give the envelope a title.';
  else if (overrides.title.trim().length > TITLE_MAX) {
    problems.title = `Keep the title under ${TITLE_MAX} characters.`;
  }
  if (overrides.message.length > MESSAGE_MAX) {
    problems.message = `Keep the message under ${MESSAGE_MAX} characters.`;
  }
  return problems;
}

/**
 * The JSON part of `POST /v1/envelopes` for one envelope from a template, sent straight away.
 * The PDFs go alongside it, keyed by document id.
 */
export function envelopeFromTemplate(
  template: { id: string; name: string },
  definition: TemplateDefinition,
  people: People,
  options: { title?: string; message?: string; metadata?: Record<string, string> } = {},
) {
  const settings = settingsBody(
    {
      title: options.title?.trim() || envelopeTitle(template.name, definition),
      message: options.message ?? definition.message,
      expiresInDays: definition.expiresInDays,
      remindEveryDays: definition.remindEveryDays,
    },
    template.name,
  );
  const actors = new Set(definition.roles.filter((r) => r.type !== 'viewer').map((r) => r.id));
  let order = 0;
  return {
    title: settings.title,
    ...(settings.message ? { message: settings.message } : {}),
    routing: definition.routing,
    expiresInDays: settings.expiresInDays,
    reminders: settings.reminders,
    metadata: { ...options.metadata, templateId: template.id },
    documents: definition.documents.map((d) => ({ key: d.id, name: d.name })),
    recipients: definition.roles.map((role) => {
      const person = people[role.id] ?? emptyPerson();
      const phone = cleanPhone(person.phone);
      if (role.type !== 'viewer') order++;
      return {
        key: role.id,
        name: person.name.trim(),
        email: person.email.trim().toLowerCase(),
        ...(phone ? { phone } : {}),
        role: role.type,
        auth: role.auth,
        ...(role.type === 'viewer' ? {} : { order: definition.routing === 'parallel' ? 1 : order }),
      };
    }),
    fields: definition.fields
      .filter((f) => actors.has(f.recipientId))
      .map((f) => ({
        document: f.documentId,
        recipient: f.recipientId,
        type: f.type,
        page: f.page,
        rect: f.rect,
        required: f.required,
        ...(f.label ? { label: f.label } : {}),
      })),
    send: true,
  };
}

/** The template in `@codevibe_technology/sign-templates`' terms, for its CSV reader. */
export function toSignTemplate(
  template: { id: string; name: string },
  definition: TemplateDefinition,
): SignTemplate {
  return {
    id: template.id,
    title: envelopeTitle(template.name, definition),
    routing: definition.routing,
    documents: definition.documents.map((d) => ({
      name: d.name,
      fileKey: d.id,
      sha256: d.sha256,
      pageSizes: d.pages,
    })),
    roles: definition.roles.map((r) => ({
      name: r.name,
      type: r.type,
      auth: r.auth,
      fields: definition.fields
        .filter((f) => f.recipientId === r.id)
        .map((f) => ({
          document: f.documentId,
          type: f.type,
          page: f.page,
          rect: f.rect,
          required: f.required,
          ...(f.label ? { label: f.label } : {}),
        })),
    })),
  };
}

export const MAX_TEMPLATE_DOCUMENTS = MAX_DOCUMENTS;

export function templateSummary(row: {
  id: string;
  name: string;
  description: string | null;
  definition: TemplateDefinition;
  updatedAt: Date | string;
  archivedAt: Date | string | null;
  createdByName: string | null;
}): TemplateSummary {
  const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    roles: row.definition.roles.map((r) => ({ name: r.name, type: r.type })),
    documentCount: row.definition.documents.length,
    pageCount: row.definition.documents.reduce((n, d) => n + d.pages.length, 0),
    updatedAt: iso(row.updatedAt),
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdByName: row.createdByName,
  };
}
