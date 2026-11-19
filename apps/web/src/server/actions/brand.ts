'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BRAND_FONTS } from '@/lib/brand';
import { MAIL_KINDS } from '@/lib/mail-templates';
import {
  removeLogo,
  setLogo,
  updateBrand,
  updateEmailSettings,
  updateSigningSettings,
} from '../brand';
import { db } from '../db';
import { env } from '../env';
import { appRuntime } from '../runtime';
import { workspaceAction } from './action';

const refresh = (slug: string) => revalidatePath(`/w/${slug}/settings/brand`);

export const updateBrandAction = workspaceAction(
  'brand.manage',
  z.object({
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1B6AE0'),
    font: z.enum(BRAND_FONTS, { error: 'Pick one of the listed fonts' }),
    senderName: z.string().max(60, 'Keep the sender name under 60 characters').optional(),
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

const override = z.object({ subject: z.string().max(2000), intro: z.string().max(5000) }).partial();

export const updateEmailSettingsAction = workspaceAction(
  'brand.manage',
  z.object({
    senderName: z.string().max(60, 'Keep the sender name under 60 characters'),
    replyTo: z.string().max(254, 'Enter an email address like hr@example.com'),
    overrides: z.partialRecord(z.enum(MAIL_KINDS), override),
  }),
  async (ctx, input) => {
    await updateEmailSettings(db(), ctx.workspace.id, input);
    refresh(ctx.workspace.slug);
  },
);

export const updateSigningSettingsAction = workspaceAction(
  'brand.manage',
  z.object({
    showBadge: z.boolean(),
    certificateFooter: z.string().max(1000),
    signingDomain: z.string().max(300),
  }),
  async (ctx, input) => {
    await updateSigningSettings(db(), ctx.workspace.id, input, new URL(env().APP_URL).hostname);
    refresh(ctx.workspace.slug);
  },
);
