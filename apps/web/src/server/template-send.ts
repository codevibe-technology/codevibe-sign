import 'server-only';
import type { ApiEnvelope as Envelope } from '@codevibe_technology/sign-server';
import type { Principal } from '@codevibe_technology/sign-server';
import { cleanPhone, type People } from '@/lib/templates';
import { AppError } from './errors';
import { apiError } from './sign/api';
import type { TemplateRecord } from './templates';

/** The sign API refused because too many envelopes were created in the last minute. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many envelopes in a minute');
    this.name = 'RateLimitedError';
  }
}

export interface TemplateSendDeps {
  /** `signRequest` in the app; a stub in tests. */
  request: (principal: Principal, path: `/v1/${string}`, init: RequestInit) => Promise<Response>;
  recordSender: (input: {
    workspaceId: string;
    envelopeId: string;
    userId: string;
  }) => Promise<void>;
}

/**
 * Creates and sends one envelope from a template with these people, as the given member,
 * through the same `POST /v1/templates/:id/envelopes` an API key calls. The server reads the
 * template and its PDFs itself, so nothing here can drift from what the API does.
 */
export async function sendFromTemplate(
  deps: TemplateSendDeps,
  input: {
    template: Pick<TemplateRecord, 'id' | 'workspaceId' | 'definition'>;
    userId: string;
    people: People;
    title?: string;
    message?: string;
    metadata?: Record<string, string>;
  },
): Promise<Envelope> {
  const { template } = input;
  const roles = Object.fromEntries(
    template.definition.roles.flatMap((role) => {
      const person = input.people[role.id];
      if (!person) return [];
      const phone = cleanPhone(person.phone);
      return [
        [
          role.id,
          {
            name: person.name.trim(),
            email: person.email.trim().toLowerCase(),
            ...(phone ? { phone } : {}),
          },
        ],
      ];
    }),
  );
  const title = input.title?.trim();
  const body = {
    roles,
    ...(title ? { title } : {}),
    // An emptied message means none, not the template's.
    ...(input.message !== undefined ? { message: input.message.trim() || null } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    send: true,
  };
  const principal: Principal = { id: `user:${input.userId}`, workspaceId: template.workspaceId };
  const res = await deps.request(
    principal,
    `/v1/templates/${encodeURIComponent(template.id)}/envelopes`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 429) {
    await res.body?.cancel().catch(() => undefined);
    throw new RateLimitedError(Number(res.headers.get('retry-after')) || 15);
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    throw new AppError('NOT_FOUND', 'That template no longer exists in this workspace.');
  }
  if (!res.ok) throw await apiError(res);
  const envelope = (await res.json()) as Envelope;
  await deps.recordSender({
    workspaceId: template.workspaceId,
    envelopeId: envelope.id,
    userId: input.userId,
  });
  return envelope;
}

/** Points an API path like `roles.<roleId>.email` at the person's field in the send form. */
export function roleField(
  path: string | undefined,
  template: Pick<TemplateRecord, 'definition'>,
): string | undefined {
  if (!path?.startsWith('roles.')) return path;
  const rest = path.slice('roles.'.length);
  const role = template.definition.roles.find(
    (r) => rest === r.id || rest.startsWith(`${r.id}.`) || rest === r.name,
  );
  if (!role) return undefined;
  const field = rest.startsWith(`${role.id}.`) ? rest.slice(role.id.length + 1) : '';
  return `people.${role.id}.${field || 'name'}`;
}
