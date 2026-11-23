'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createApiKey, revokeApiKey } from '../api-keys';
import { db } from '../db';
import { workspaceAction } from './action';

const refresh = (slug: string) => revalidatePath(`/dashboard/${slug}/settings/api-keys`);

export const createApiKeyAction = workspaceAction(
  'apiKeys.manage',
  z.object({ name: z.string({ error: 'Name the key after what will use it' }) }),
  async (ctx, input) => {
    const created = await createApiKey(db(), {
      workspaceId: ctx.workspace.id,
      name: input.name,
      createdBy: ctx.user.id,
    });
    refresh(ctx.workspace.slug);
    return { key: created.key, prefix: created.prefix };
  },
);

export const revokeApiKeyAction = workspaceAction(
  'apiKeys.manage',
  z.object({ keyId: z.string().min(1).max(64) }),
  async (ctx, input) => {
    await revokeApiKey(db(), ctx.workspace.id, input.keyId);
    refresh(ctx.workspace.slug);
  },
);
