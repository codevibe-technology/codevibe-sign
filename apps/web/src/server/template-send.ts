import 'server-only';
import type { FileStore } from '@codevibe_technology/sign-core';
import type { ApiEnvelope as Envelope } from '@codevibe_technology/sign-server';
import type { Principal } from '@codevibe_technology/sign-server';
import { envelopeFromTemplate, type People } from '@/lib/templates';
import { AppError } from './errors';
import { apiError } from './sign/api';
import { templateFileKey, type TemplateRecord } from './templates';

/** The sign API refused because too many envelopes were created in the last minute. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many envelopes in a minute');
    this.name = 'RateLimitedError';
  }
}

export interface TemplateSendDeps {
  files: FileStore;
  /** `signRequest` in the app; a stub in tests. */
  request: (principal: Principal, path: `/v1/${string}`, init: RequestInit) => Promise<Response>;
  recordSender: (input: {
    workspaceId: string;
    envelopeId: string;
    userId: string;
  }) => Promise<void>;
}

/**
 * Creates and sends one envelope from a template with these people, as the given member. The
 * template's PDFs are read from storage, so the browser never uploads them again.
 */
export async function sendFromTemplate(
  deps: TemplateSendDeps,
  input: {
    template: TemplateRecord;
    userId: string;
    people: People;
    title?: string;
    message?: string;
    metadata?: Record<string, string>;
  },
): Promise<Envelope> {
  const { template } = input;
  const body = envelopeFromTemplate(template, template.definition, input.people, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  const form = new FormData();
  form.set('envelope', JSON.stringify(body));
  for (const doc of template.definition.documents) {
    const bytes = await deps.files.get(templateFileKey(template.workspaceId, template.id, doc.id));
    if (!bytes) {
      throw new AppError(
        'CONFLICT',
        `${doc.name} is missing from storage. Edit the template and add it again.`,
      );
    }
    form.append('documents', new Blob([bytes as BlobPart], { type: 'application/pdf' }), doc.name);
  }
  const principal: Principal = { id: `user:${input.userId}`, workspaceId: template.workspaceId };
  const res = await deps.request(principal, '/v1/envelopes', { method: 'POST', body: form });
  if (res.status === 429) {
    await res.body?.cancel().catch(() => undefined);
    throw new RateLimitedError(Number(res.headers.get('retry-after')) || 15);
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

/** Points an API path like `recipients[1].email` at the role it belongs to. */
export function roleField(path: string | undefined, template: TemplateRecord): string | undefined {
  const match = path ? /^recipients\[(\d+)\]\.?(.*)$/.exec(path) : null;
  if (!match) return path;
  const role = template.definition.roles[Number(match[1])];
  return role ? `people.${role.id}.${match[2] || 'name'}` : undefined;
}
