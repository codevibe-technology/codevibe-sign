'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '../db';
import { env } from '../env';
import { AppError } from '../errors';
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
  return { slug: workspace.slug };
});

export const renameWorkspaceAction = workspaceAction(
  'workspace.manage',
  z.object({ name }),
  async (ctx, input) => {
    const renamed = await renameWorkspace(db(), ctx.workspace.id, input.name);
    revalidatePath(`/w/${ctx.workspace.slug}`, 'layout');
    return { name: renamed };
  },
);
