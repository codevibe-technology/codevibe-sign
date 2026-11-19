'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BRAND_FONTS } from '@/lib/brand';
import { removeLogo, setLogo, updateBrand } from '../brand';
import { db } from '../db';
import { appRuntime } from '../runtime';
import { workspaceAction } from './action';

const refresh = (slug: string) => revalidatePath(`/w/${slug}/settings/brand`);

export const updateBrandAction = workspaceAction(
  'brand.manage',
  z.object({
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1B6AE0'),
    font: z.enum(BRAND_FONTS, { error: 'Pick one of the listed fonts' }),
    senderName: z.string().max(60, 'Keep the sender name under 60 characters'),
  }),
  async (ctx, input) => {
    await updateBrand(db(), ctx.workspace.id, input);
    refresh(ctx.workspace.slug);
  },
);

export const uploadLogoAction = workspaceAction(
  'brand.manage',
  z.object({ logo: z.instanceof(File, { error: 'Choose an image file' }) }),
  async (ctx, input) => {
    const bytes = new Uint8Array(await input.logo.arrayBuffer());
    await setLogo(db(), appRuntime().files, ctx.workspace.id, bytes);
    refresh(ctx.workspace.slug);
  },
);

export const removeLogoAction = workspaceAction('brand.manage', z.object({}), async (ctx) => {
  await removeLogo(db(), appRuntime().files, ctx.workspace.id);
  refresh(ctx.workspace.slug);
});
