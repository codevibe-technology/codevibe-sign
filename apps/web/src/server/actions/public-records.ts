'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canVoidEnvelope } from '@/lib/roles';
import { db } from '../db';
import { sentBy } from '../envelopes';
import { AppError } from '../errors';
import { setPublicRecords, setRecordRevoked } from '../public-records';
import { workspaceAction } from './action';

/**
 * Turns the public record of one envelope off or on again. Members may do it for what they
 * sent from the app; admins and owners for anything.
 */
export const setRecordRevokedAction = workspaceAction(
  'envelopes.write',
  z.object({ envelopeId: z.string().min(1).max(100), revoked: z.boolean() }),
  async (ctx, input) => {
    const sql = db();
    const mine = await sentBy(sql, ctx.workspace.id, ctx.user.id, [input.envelopeId]);
    if (!canVoidEnvelope(ctx.role, mine.has(input.envelopeId))) {
      throw new AppError(
        'FORBIDDEN',
        'Only an admin can change the public record of an envelope someone else sent.',
      );
    }
    const found = await setRecordRevoked(sql, {
      workspaceId: ctx.workspace.id,
      envelopeId: input.envelopeId,
      revoked: input.revoked,
      userId: ctx.user.id,
    });
    if (!found) throw new AppError('NOT_FOUND', 'This envelope has no public record.');
    revalidatePath(`/dashboard/${ctx.workspace.slug}/envelopes/${input.envelopeId}`);
    return { revoked: input.revoked };
  },
);

/** Whether the workspace's completed documents get a public record page at all. */
export const setPublicRecordsAction = workspaceAction(
  'workspace.manage',
  z.object({ enabled: z.boolean() }),
  async (ctx, input) => {
    const enabled = await setPublicRecords(db(), ctx.workspace.id, input.enabled);
    revalidatePath(`/dashboard/${ctx.workspace.slug}/settings/workspace`);
    return { enabled };
  },
);
