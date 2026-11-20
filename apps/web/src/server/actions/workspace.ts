'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '../db';
import { recordSender } from '../envelopes';
import { env } from '../env';
import { AppError } from '../errors';
import { createSampleEnvelope, dismissStartHere } from '../sample-envelope';
import { signRequest } from '../sign/client';
import { countWorkspaces, createWorkspace, renameWorkspace } from '../workspaces';
import { userAction, workspaceAction } from './action';

const name = z.string({ error: 'Give the workspace a name' });

export const createWorkspaceAction = userAction(z.object({ name }), async (user, input) => {
  const sql = db();
  if (env().SINGLE_WORKSPACE && (await countWorkspaces(sql)) > 0) {
    throw new AppError(
      'FORBIDDEN',
      'This installation has one workspace. Ask its admin to invite you.',
    );
  }
  const workspace = await createWorkspace(sql, { name: input.name, userId: user.id });
  if (workspace.plan === 'free') {
    // The workspace stands without the sample; a failure here only costs the "Start here" card.
    await createSampleEnvelope(
      { sql, request: signRequest, recordSender: (r) => recordSender(sql, r) },
      { workspaceId: workspace.id, user },
    ).catch((err: unknown) =>
      console.error('sample envelope failed', err instanceof Error ? err.message : err),
    );
  }
  return { slug: workspace.slug };
});

export const dismissStartHereAction = workspaceAction(
  'envelopes.read',
  z.object({}),
  async (ctx) => {
    await dismissStartHere(db(), ctx.workspace.id);
    revalidatePath(`/w/${ctx.workspace.slug}`);
  },
);

export const renameWorkspaceAction = workspaceAction(
  'workspace.manage',
  z.object({ name }),
  async (ctx, input) => {
    const renamed = await renameWorkspace(db(), ctx.workspace.id, input.name);
    revalidatePath(`/w/${ctx.workspace.slug}`, 'layout');
    return { name: renamed };
  },
);
