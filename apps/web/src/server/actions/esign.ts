'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { SignError } from '@codevibe_technology/sign-core';
import { memoryRateLimiter, type RateLimiter } from '@codevibe_technology/sign-server';
import { z } from 'zod';
import { recordAudit } from '../billing/audit';
import { billingConfig } from '../billing/config';
import { clientAddress } from '../client-address';
import { db } from '../db';
import { AppError } from '../errors';
import { providerForCredentials } from '../esign/runtime';
import {
  getEsignSettings,
  ownCredentials,
  recordConnectionTest,
  removeOwnCredentials,
  saveOwnCredentials,
  setEsignMode,
  type EsignSettings,
} from '../esign/settings';
import { assertOwnEsignAccount } from '../plans';
import { workspaceAction, type ActionContext } from './action';

const refresh = (slug: string) => revalidatePath(`/dashboard/${slug}`, 'layout');

const holder = globalThis as unknown as { __cvsEsignLimiter?: RateLimiter };
const limiter = () => (holder.__cvsEsignLimiter ??= memoryRateLimiter({ maxKeys: 10_000 }));
const TEN_MINUTES = 10 * 60 * 1000;

async function limit(what: string, ctx: ActionContext, max: number): Promise<void> {
  const hit = await limiter().hit(
    `${what}:${ctx.workspace.id}:${ctx.user.id}`,
    max,
    TEN_MINUTES,
    new Date(),
  );
  if (!hit.allowed) {
    throw new AppError(
      'CONFLICT',
      'Too many attempts in a short time. Wait a few minutes and try again.',
    );
  }
}

async function audit(
  ctx: ActionContext,
  action: string,
  data: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await recordAudit(db(), {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action,
    data,
    ip: clientAddress(await headers()),
  });
}

/** Chooses whose provider account the workspace's Aadhaar eSigns go through. */
export const setEsignModeAction = workspaceAction(
  'esign.manage',
  z.object({ mode: z.enum(['platform', 'own']) }),
  async (ctx, input): Promise<EsignSettings> => {
    const sql = db();
    if (input.mode === 'own') await assertOwnEsignAccount(sql, ctx.workspace.id);
    const before = await getEsignSettings(sql, ctx.workspace.id);
    const saved = await setEsignMode(sql, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      mode: input.mode,
    });
    if (before.mode !== saved.mode) {
      await audit(ctx, 'esign.settings_updated', { mode: saved.mode });
    }
    refresh(ctx.workspace.slug);
    return saved;
  },
);

const secret = (label: string) =>
  z
    .string()
    .trim()
    .min(8, `Paste the ${label} from Leegality, API settings`)
    .max(512, `That ${label} is too long`)
    .regex(/^[\x21-\x7e]+$/, `The ${label} cannot contain spaces`);

const credentialsShape = {
  apiKey: secret('Auth Token'),
  privateSalt: secret('Private Salt'),
  workflowId: z
    .string()
    .trim()
    .min(1, 'Enter the Workflow ID')
    .max(128, 'That Workflow ID is too long')
    .regex(/^[A-Za-z0-9_-]+$/, 'A Workflow ID has letters, digits, hyphens and underscores only'),
  environment: z.enum(['sandbox', 'production']),
};

/** The operator has switched the install to live payments and eSigns. */
function liveInstall(): boolean {
  try {
    return billingConfig().live;
  } catch {
    return false;
  }
}

/** Why a try of the provider's credentials failed, in words that name what to fix. */
function connectionProblem(error: unknown): string {
  const reason = error instanceof SignError ? error.details?.reason : undefined;
  if (reason === 'unauthorized' || reason === 'rejected') {
    return 'Leegality did not accept these details. Check the Auth Token and that it belongs to the environment you chose.';
  }
  if (error instanceof SignError && error.code === 'RATE_LIMITED') {
    return 'Leegality is limiting requests right now. Try again in a minute.';
  }
  return 'Leegality could not be reached. Try again in a minute.';
}

/**
 * Saves the workspace's own Leegality account. The values are tried against Leegality first
 * and are stored encrypted; nothing ever sends them back to a browser.
 */
export const saveEsignCredentialsAction = workspaceAction(
  'esign.manage',
  z.object(credentialsShape),
  async (ctx, input): Promise<EsignSettings> => {
    await limit('save', ctx, 10);
    const sql = db();
    await assertOwnEsignAccount(sql, ctx.workspace.id);
    const { apiKey, privateSalt, workflowId, environment } = input;
    if (environment === 'sandbox' && liveInstall()) {
      throw new AppError(
        'VALIDATION',
        'A sandbox account is for testing only, and signatures made there have no legal effect. Connect your production Leegality account.',
        'environment',
      );
    }
    const credentials = { apiKey, privateSalt, workflowId, environment };
    let ok = true;
    try {
      await providerForCredentials(credentials).checkCredentials?.();
    } catch (error) {
      const reason = error instanceof SignError ? error.details?.reason : undefined;
      if (reason === 'unauthorized' || reason === 'rejected') {
        throw new AppError('VALIDATION', connectionProblem(error), 'apiKey');
      }
      ok = false;
    }
    await saveOwnCredentials(sql, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      credentials,
    });
    await recordConnectionTest(sql, ctx.workspace.id, ok);
    await audit(ctx, 'esign.credentials_saved', { environment, checked: ok });
    refresh(ctx.workspace.slug);
    return getEsignSettings(sql, ctx.workspace.id);
  },
);

export const removeEsignCredentialsAction = workspaceAction(
  'esign.manage',
  z.object({}),
  async (ctx): Promise<EsignSettings> => {
    const saved = await removeOwnCredentials(db(), {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
    });
    await audit(ctx, 'esign.credentials_removed');
    refresh(ctx.workspace.slug);
    return saved;
  },
);

/** Tries the saved account with one read-only call and says whether Leegality accepted it. */
export const testEsignConnectionAction = workspaceAction(
  'esign.manage',
  z.object({}),
  async (ctx): Promise<{ ok: boolean; message: string }> => {
    await limit('test', ctx, 10);
    const sql = db();
    const credentials = await ownCredentials(sql, ctx.workspace.id);
    if (!credentials) {
      throw new AppError('VALIDATION', 'Add your Leegality account details first.', 'credentials');
    }
    let result: { ok: boolean; message: string };
    try {
      await providerForCredentials(credentials).checkCredentials?.();
      result = { ok: true, message: 'Leegality accepted these details.' };
    } catch (error) {
      result = { ok: false, message: connectionProblem(error) };
    }
    await recordConnectionTest(sql, ctx.workspace.id, result.ok);
    await audit(ctx, 'esign.credentials_tested', { ok: result.ok });
    refresh(ctx.workspace.slug);
    return result;
  },
);
