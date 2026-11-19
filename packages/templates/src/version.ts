import { DEFAULT_REMINDERS, type Hasher } from '@codevibe/sign-core';
import type { Template, TemplateRole } from './types';
import { isActorRole } from './validate';

/** JSON with keys sorted at every level and undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cannot canonicalize a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`);
}

export interface ResolvedRole extends TemplateRole {
  type: NonNullable<TemplateRole['type']>;
  order: number;
  fields: NonNullable<TemplateRole['fields']>;
}

/** Sequential orders as the template means them: unset orders follow the role's position. */
export function resolveRoles(roles: TemplateRole[]): ResolvedRole[] {
  let position = 0;
  return roles.map((role) => {
    const type = role.type ?? 'signer';
    const order = isActorRole(role) ? (role.order ?? ++position) : (role.order ?? 1);
    if (isActorRole(role) && role.order !== undefined) position = Math.max(position, role.order);
    return { ...role, type, order, fields: role.fields ?? [] };
  });
}

/** The template with every default written out, so equivalent templates hash the same. */
export function normalizeTemplate(template: Template): Template {
  return {
    ...template,
    routing: template.routing ?? 'sequential',
    reminders: template.reminders ?? DEFAULT_REMINDERS,
    roles: resolveRoles(template.roles).map((role) => ({
      ...role,
      fields: role.fields.map((field) => ({
        ...field,
        required: field.required ?? true,
        readOnly: field.readOnly ?? false,
      })),
    })),
  };
}

/**
 * SHA-256 over the template's canonical JSON, defaults filled in. Any change that alters what
 * an envelope would look like gives a new version; key order and spelled-out defaults do not.
 */
export function templateVersion(template: Template, hasher: Hasher): Promise<string> {
  return hasher.sha256(canonicalJson(normalizeTemplate(template)));
}
