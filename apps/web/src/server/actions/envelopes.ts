'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, canVoidEnvelope } from '@/lib/roles';
import { db } from '../db';
import { findSealedDocument, sentBy } from '../envelopes';
import { AppError } from '../errors';
import { inspectUpload, verifyUpload } from '../pdf';
import { signApi, userPrincipal } from '../sign/api';
import { workspaceAction } from './action';

const id = z.string().min(1).max(100);
const pdfFile = z.instanceof(File, { error: 'Choose a PDF file' });

/** Page sizes of a PDF before it goes into an envelope, or a message on how to fix it. */
export const inspectDocumentAction = workspaceAction(
  'envelopes.write',
  z.object({ file: pdfFile }),
  async (_ctx, input) =>
    inspectUpload(input.file.name, new Uint8Array(await input.file.arrayBuffer())),
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
    revalidatePath(`/w/${ctx.workspace.slug}`, 'layout');
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
    revalidatePath(`/w/${ctx.workspace.slug}/envelopes/${input.envelopeId}`);
    return { reminded: envelope.recipients.filter((r) => r.lastRemindedAt).length };
  },
);

/** Checks an uploaded PDF against this install's seal and finds the envelope it came from. */
export const verifyDocumentAction = workspaceAction(
  'envelopes.read',
  z.object({ file: pdfFile }),
  async (ctx, input) => {
    const outcome = await verifyUpload(new Uint8Array(await input.file.arrayBuffer()));
    const match = outcome.valid
      ? await findSealedDocument(db(), ctx.workspace.id, outcome.sha256)
      : null;
    return { ...outcome, fileName: input.file.name, envelope: match };
  },
);
