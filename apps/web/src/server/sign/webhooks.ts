import type { WebhookTarget } from '@codevibe_technology/sign-server';

/**
 * A workspace's webhook targets, given its id. None yet: the webhooks lane keeps them in an
 * `app_webhooks` table (URL, secret, events, per workspace) and reads them here.
 */
export const webhookTargets = async (): Promise<WebhookTarget[]> => [];
