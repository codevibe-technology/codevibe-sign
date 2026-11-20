'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '../db';
import { AppError } from '../errors';
import { signServer } from '../sign/server';
import { webhookRules } from '../sign/webhooks';
import {
  createWebhook,
  deleteWebhook,
  getDelivery,
  getWebhook,
  rollWebhookSecret,
  setWebhookEnabled,
  updateWebhook,
} from '../webhooks';
import { workspaceAction } from './action';

const id = z.string().min(1).max(100);
const endpoint = {
  url: z.string().max(4000),
  description: z.string().max(1000),
  events: z.array(z.string().max(100)).max(50),
};
const refresh = (slug: string) => revalidatePath(`/w/${slug}/settings/webhooks`, 'layout');

export const createWebhookAction = workspaceAction(
  'webhooks.manage',
  z.object(endpoint),
  async (ctx, input) => {
    const created = await createWebhook(
      db(),
      { ...input, workspaceId: ctx.workspace.id, createdBy: ctx.user.id },
      webhookRules(),
    );
    refresh(ctx.workspace.slug);
    return created;
  },
);

export const updateWebhookAction = workspaceAction(
  'webhooks.manage',
  z.object({ webhookId: id, ...endpoint }),
  async (ctx, input) => {
    await updateWebhook(db(), ctx.workspace.id, input.webhookId, input, webhookRules());
    refresh(ctx.workspace.slug);
  },
);

export const setWebhookEnabledAction = workspaceAction(
  'webhooks.manage',
  z.object({ webhookId: id, enabled: z.boolean() }),
  async (ctx, input) => {
    await setWebhookEnabled(db(), ctx.workspace.id, input.webhookId, input.enabled);
    refresh(ctx.workspace.slug);
  },
);

export const rollWebhookSecretAction = workspaceAction(
  'webhooks.manage',
  z.object({ webhookId: id }),
  async (ctx, input) => ({
    secret: await rollWebhookSecret(db(), ctx.workspace.id, input.webhookId),
  }),
);

export const deleteWebhookAction = workspaceAction(
  'webhooks.manage',
  z.object({ webhookId: id }),
  async (ctx, input) => {
    await deleteWebhook(db(), ctx.workspace.id, input.webhookId);
    refresh(ctx.workspace.slug);
  },
);

const outcomeView = (report: { outcome: string; status: number | null; error: string | null }) => ({
  outcome: report.outcome as 'delivered' | 'failed' | 'skipped',
  status: report.status,
  error: report.error,
});

/** Posts a signed `webhook.test` event to the endpoint now. */
export const testWebhookAction = workspaceAction(
  'webhooks.manage',
  z.object({ webhookId: id }),
  async (ctx, input) => {
    const webhook = await getWebhook(db(), ctx.workspace.id, input.webhookId);
    if (!webhook)
      throw new AppError('NOT_FOUND', 'That endpoint no longer exists in this workspace.');
    if (!webhook.enabled)
      throw new AppError('CONFLICT', 'Turn the endpoint on to send it a test event.');
    const report = await signServer().sendTestWebhook({
      workspaceId: ctx.workspace.id,
      url: webhook.url,
    });
    refresh(ctx.workspace.slug);
    return outcomeView(report);
  },
);

/** Posts a logged delivery again, with the same id and body, to the endpoint's current URL. */
export const retryDeliveryAction = workspaceAction(
  'webhooks.manage',
  z.object({ webhookId: id, deliveryId: id }),
  async (ctx, input) => {
    const sql = db();
    const webhook = await getWebhook(sql, ctx.workspace.id, input.webhookId);
    if (!webhook)
      throw new AppError('NOT_FOUND', 'That endpoint no longer exists in this workspace.');
    if (!webhook.enabled) throw new AppError('CONFLICT', 'Turn the endpoint on to send it again.');
    const delivery = await getDelivery(sql, ctx.workspace.id, webhook.id, input.deliveryId);
    if (!delivery) throw new AppError('NOT_FOUND', 'That delivery is no longer in the log.');
    const report = await signServer().redeliverWebhook({
      workspaceId: ctx.workspace.id,
      url: webhook.url,
      deliveryId: delivery.deliveryId,
      body: delivery.body,
    });
    refresh(ctx.workspace.slug);
    return outcomeView(report);
  },
);
