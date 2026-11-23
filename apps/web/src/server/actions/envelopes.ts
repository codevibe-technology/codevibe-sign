'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, canVoidEnvelope } from '@/lib/roles';
import { db } from '../db';
import { findSealedDocument, recordSender, sentBy } from '../envelopes';
import { AppError } from '../errors';
import { inspectUpload, verifySummary, verifyUpload } from '../pdf';
import { assertWithin, workspacePlan } from '../plans';
import { signApi, userPrincipal } from '../sign/api';
import { workspaceAction, type ActionContext } from './action';
import { displayName } from '@/lib/person-name';

const id = z.string().min(1).max(100);
const pdfFile = z.instanceof(File, { error: 'Choose a PDF file' });

/** Page sizes of a PDF before it goes into an envelope, or a message on how to fix it. */
export const inspectDocumentAction = workspaceAction(
  'envelopes.write',
  z.object({ file: pdfFile }),
  async (ctx, input) => {
    assertWithin(await workspacePlan(db(), ctx.workspace.id), 'fileBytes', input.file.size, 'file');
    return inspectUpload(input.file.name, new Uint8Array(await input.file.arrayBuffer()));
  },
);

/**
 * Withdraws envelopes with one reason. Members may withdraw what they sent from the app;
 * admins and owners anything. Each envelope succeeds or fails on its own.
 */
export const voidEnvelopesAction = workspaceAction(
  'envelopes.write',
  z.object({
    envelopeIds: z
      .array(id)
      .min(1, 'Pick at least one envelope')
      .max(100, 'Void at most 100 at a time'),
    reason: z
      .string()
      .trim()
      .min(1, 'Say why, so the recipients know')
      .max(1000, 'Keep the reason under 1000 characters'),
  }),
  async (ctx, input) => {
    const ids = [...new Set(input.envelopeIds)];
    const mine = await sentBy(db(), ctx.workspace.id, ctx.user.id, ids);
    const api = signApi(userPrincipal(ctx.user.id, ctx.workspace.id));
    const voided: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const envelopeId of ids) {
      if (!canVoidEnvelope(ctx.role, mine.has(envelopeId))) {
        failed.push({
          id: envelopeId,
          error: 'Only an admin can void an envelope someone else sent.',
        });
        continue;
      }
      try {
        await api.void(envelopeId, input.reason);
        voided.push(envelopeId);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        failed.push({ id: envelopeId, error: err.message });
      }
    }
    if (voided.length === 0) {
      throw new AppError(
        failed.every((f) => f.error.startsWith('Only an admin')) ? 'FORBIDDEN' : 'CONFLICT',
        ids.length === 1 ? failed[0]!.error : `None could be voided. ${failed[0]!.error}`,
      );
    }
    revalidatePath(`/dashboard/${ctx.workspace.slug}`, 'layout');
    return { voided, failed };
  },
);

/**
 * Mails a fresh signing link to whoever's turn it is, or to one recipient. Anyone may ask for
 * their own link again; reminding others needs the right to send.
 */
export const remindAction = workspaceAction(
  'envelopes.read',
  z.object({ envelopeId: id, recipientId: id.optional() }),
  async (ctx, input) => {
    const api = signApi(userPrincipal(ctx.user.id, ctx.workspace.id));
    if (!can(ctx.role, 'envelopes.write')) {
      const envelope = await api.get(input.envelopeId);
      const self = envelope.recipients.find((r) => r.id === input.recipientId);
      if (!self || self.email !== ctx.user.email.toLowerCase()) {
        throw new AppError('FORBIDDEN', 'Your role can only ask for your own signing link again.');
      }
    }
    const envelope = await api.remind(input.envelopeId, input.recipientId);
    revalidatePath(`/dashboard/${ctx.workspace.slug}/envelopes/${input.envelopeId}`);
    return { reminded: envelope.recipients.filter((r) => r.lastRemindedAt).length };
  },
);

/** Checks an uploaded PDF against this install's seal and finds the envelope it came from. */
export const verifyDocumentAction = workspaceAction(
  'envelopes.read',
  z.object({ file: pdfFile }),
  async (ctx, input) => {
    const checked = await verifyUpload(new Uint8Array(await input.file.arrayBuffer()));
    const found = await findSealedDocument(db(), ctx.workspace.id, checked.sha256);
    // A file an eSign provider locked carries no seal of ours; its fingerprint in the audit
    // trail is what shows it is the signed document.
    const outcome =
      !checked.valid && found?.providerOnly
        ? {
            ...checked,
            valid: true,
            reason: null,
            seal: 'provider_only' as const,
            summary: verifySummary(true, null, 'workspace', { seal: 'provider_only' }),
          }
        : checked;
    const match = outcome.valid && found ? found : null;
    return { ...outcome, fileName: input.file.name, envelope: match };
  },
);

const actor = (ctx: { user: { name: string; email: string } }) => displayName(ctx.user);

/**
 * A fresh signing link for the recipient whose turn it is, for the admin to pass on by hand.
 * Their earlier links stop working. The link is returned once and kept nowhere.
 */
export const shareLinkAction = workspaceAction(
  'links.share',
  z.object({ envelopeId: id, recipientId: id }),
  async (ctx, input) => {
    const api = signApi(userPrincipal(ctx.user.id, ctx.workspace.id, false, actor(ctx)));
    const { url } = await api.shareLink(input.envelopeId, input.recipientId);
    revalidatePath(`/dashboard/${ctx.workspace.slug}/envelopes/${input.envelopeId}`);
    return { url };
  },
);

/** Corrects the name, email or phone of a recipient who has not acted yet. */
export const correctRecipientAction = workspaceAction(
  'envelopes.write',
  z.object({
    envelopeId: id,
    recipientId: id,
    name: z.string().trim().min(1, 'Enter a name').max(200, 'Keep the name under 200 characters'),
    email: z.string().trim().max(254).optional(),
    phone: z.string().trim().max(20).optional(),
    resend: z.boolean().optional(),
  }),
  async (ctx, input) => {
    // A corrected address receives the signing link, so a member may only correct their own.
    const mine = await sentBy(db(), ctx.workspace.id, ctx.user.id, [input.envelopeId]);
    if (!canVoidEnvelope(ctx.role, mine.has(input.envelopeId))) {
      throw new AppError(
        'FORBIDDEN',
        'Only an admin can change the recipients of an envelope someone else sent.',
      );
    }
    const api = signApi(userPrincipal(ctx.user.id, ctx.workspace.id, false, actor(ctx)));
    const before = (await api.get(input.envelopeId)).recipients.find(
      (r) => r.id === input.recipientId,
    );
    const envelope = await api.correctRecipient(input.envelopeId, input.recipientId, {
      name: input.name,
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.resend ? { resend: true } : {}),
    });
    revalidatePath(`/dashboard/${ctx.workspace.slug}/envelopes/${input.envelopeId}`);
    const after = envelope.recipients.find((r) => r.id === input.recipientId);
    const invited =
      after?.notifiedAt !== before?.notifiedAt || after?.lastRemindedAt !== before?.lastRemindedAt;
    return { invited };
  },
);

async function copyToDraft(
  ctx: ActionContext,
  envelopeId: string,
  make: (api: ReturnType<typeof signApi>) => Promise<{ draft: { id: string } }>,
) {
  const mine = await sentBy(db(), ctx.workspace.id, ctx.user.id, [envelopeId]);
  if (!canVoidEnvelope(ctx.role, mine.has(envelopeId))) {
    throw new AppError('FORBIDDEN', 'Only an admin can change an envelope someone else sent.');
  }
  const api = signApi(userPrincipal(ctx.user.id, ctx.workspace.id, false, actor(ctx)));
  const { draft } = await make(api);
  await recordSender(db(), {
    workspaceId: ctx.workspace.id,
    envelopeId: draft.id,
    userId: ctx.user.id,
  });
  revalidatePath(`/dashboard/${ctx.workspace.slug}`, 'layout');
  return { draftId: draft.id };
}

/**
 * Recall and edit: voids a sent envelope and makes a draft copy to correct and send again.
 * Allowed to whoever may void it.
 */
export const recallEnvelopeAction = workspaceAction(
  'envelopes.write',
  z.object({
    envelopeId: id,
    note: z.string().trim().max(900, 'Keep the note under 900 characters').optional(),
  }),
  (ctx, input) =>
    copyToDraft(ctx, input.envelopeId, (api) => api.recall(input.envelopeId, input.note)),
);

/** Revise and resend: copies a declined envelope to a new draft. The declined one stays. */
export const reviseEnvelopeAction = workspaceAction(
  'envelopes.write',
  z.object({ envelopeId: id }),
  (ctx, input) => copyToDraft(ctx, input.envelopeId, (api) => api.revise(input.envelopeId)),
);

/** Replaces a draft's PDF; says which fields were moved and need checking. */
export const replaceDocumentAction = workspaceAction(
  'envelopes.write',
  z.object({ envelopeId: id, documentId: id, file: pdfFile }),
  async (ctx, input) => {
    assertWithin(await workspacePlan(db(), ctx.workspace.id), 'fileBytes', input.file.size, 'file');
    const form = new FormData();
    form.set('document', input.file, input.file.name);
    form.set('name', input.file.name);
    const api = signApi(userPrincipal(ctx.user.id, ctx.workspace.id));
    const { envelope, movedFields } = await api.replaceDocument(
      input.envelopeId,
      input.documentId,
      form,
    );
    return { envelope, movedFields };
  },
);
