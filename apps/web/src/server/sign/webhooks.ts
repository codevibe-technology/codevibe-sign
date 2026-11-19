import 'server-only';
import { checkWebhookUrl, type WebhookSecurity } from '@codevibe_technology/sign-server';
import { db } from '../db';
import { env } from '../env';
import { webhookTargetsFor, type WebhookRules } from '../webhooks';

/** How strict webhook URLs are: public https only, unless the operator relaxed it. */
export const webhookSecurity = (): WebhookSecurity =>
  env().WEBHOOK_ALLOW_INSECURE ? { allowInsecure: true } : {};

/** The rules endpoints are saved under, matching what the sign server will deliver to. */
export const webhookRules = (): WebhookRules => {
  const security = webhookSecurity();
  return {
    allowInsecure: security.allowInsecure ?? false,
    checkUrl: (url) => void checkWebhookUrl(url, security),
  };
};

/** A workspace's live endpoints, read when an event happens and again before each delivery. */
export const webhookTargets = (workspaceId: string) => webhookTargetsFor(db(), workspaceId);
