import 'server-only';
import { createHash } from 'node:crypto';
import {
  createLeegalityProvider,
  type EsignProvider,
  type FetchLike,
} from '@codevibe_technology/sign-aadhaar';
import { SignError } from '@codevibe_technology/sign-core';
import type { EsignOptions, EsignUnavailable } from '@codevibe_technology/sign-server';
import type postgres from 'postgres';
import { billingVisible } from '@/lib/plans';
import { recordAudit } from '../billing/audit';
import {
  LEEGALITY_PRODUCTION_URL,
  LEEGALITY_SANDBOX_URL,
  billingConfig,
  esignPrice,
  type BillingConfig,
  type LeegalityConfig,
} from '../billing/config';
import { consumeCredit, creditBalance, releaseCredit, reserveCredit } from '../billing/credits';
import { planSettings, workspaceEntitlements } from '../plans';
import { getEsignSettings, ownCredentials, type EsignMode, type OwnCredentials } from './settings';
import { getEsignUsage, markUnbilled, recordEsignOutcome, recordEsignStart } from './usage';

type Sql = postgres.Sql;

export interface EsignRuntimeDeps {
  sql: Sql;
  /** The operator's billing settings; throws when one is malformed. */
  config?: () => BillingConfig;
  /** Replaces `fetch` for calls to the provider, in tests. */
  fetch?: FetchLike;
}

const SIGNER_NO_CREDITS =
  'Aadhaar eSign is not available for this document right now. The sender has been told.';

/**
 * Why Aadhaar eSign cannot be used by a workspace, in words for whoever sends. The reasons:
 * `not_configured`, `own_not_configured`, `own_not_in_plan`, `price_not_set`, `no_credits`.
 */
export const ESIGN_BLOCKED: Record<string, string> = {
  not_configured_hosted:
    'Aadhaar eSign is coming soon. It is not switched on for this service yet.',
  not_configured:
    'Aadhaar eSign is not set up. Connect a Leegality account in Settings, Aadhaar eSign.',
  own_not_configured:
    'Your Leegality account details are missing or can no longer be read. Add them again in Settings, Aadhaar eSign.',
  own_not_in_plan:
    'Your own Leegality account is not part of the Free plan. Upgrade to Cloud, or switch to prepaid credits in Settings, Aadhaar eSign.',
  price_not_set: 'Aadhaar eSign is coming soon. Its price has not been published yet.',
  no_credits:
    'This workspace has no Aadhaar eSign credits left. Buy credits in Settings, Billing.',
};

export interface EsignState {
  mode: EsignMode;
  /** eSigns on the install's account are paid for with prepaid credits. */
  creditsRequired: boolean;
  /** Null when an eSign can start now. */
  blocked: { reason: string; message: string } | null;
}

const safeConfig = (deps: EsignRuntimeDeps): BillingConfig | null => {
  try {
    return (deps.config ?? billingConfig)();
  } catch {
    return null;
  }
};

/** Whether a workspace can start an Aadhaar eSign now, and on which account. */
export async function esignState(deps: EsignRuntimeDeps, workspaceId: string): Promise<EsignState> {
  const { sql } = deps;
  const settings = planSettings();
  const hosted = billingVisible(settings);
  const [saved, entitlements] = await Promise.all([
    getEsignSettings(sql, workspaceId),
    workspaceEntitlements(sql, workspaceId, settings),
  ]);
  const block = (reason: string, key = reason) => ({
    reason,
    message: ESIGN_BLOCKED[key] ?? ESIGN_BLOCKED.not_configured!,
  });

  if (saved.mode === 'own') {
    const blocked = !entitlements.ownEsignAccount
      ? block('own_not_in_plan')
      : !saved.own.configured || !(await ownCredentials(sql, workspaceId))
        ? block('own_not_configured')
        : null;
    return { mode: 'own', creditsRequired: false, blocked };
  }

  const config = safeConfig(deps);
  if (!config?.leegality) {
    return {
      mode: 'platform',
      creditsRequired: hosted,
      blocked: block('not_configured', hosted ? 'not_configured_hosted' : 'not_configured'),
    };
  }
  if (!hosted) return { mode: 'platform', creditsRequired: false, blocked: null };
  if (!esignPrice(config, entitlements.plan)) {
    return { mode: 'platform', creditsRequired: true, blocked: block('price_not_set') };
  }
  const { available } = await creditBalance(sql, workspaceId);
  return {
    mode: 'platform',
    creditsRequired: true,
    blocked: available < 1 ? block('no_credits') : null,
  };
}

function fromOwn(credentials: OwnCredentials, fetch?: FetchLike): EsignProvider {
  return createLeegalityProvider({
    authToken: credentials.apiKey,
    privateSalt: credentials.privateSalt,
    profileId: credentials.workflowId,
    environment: credentials.environment,
    baseUrl:
      credentials.environment === 'production' ? LEEGALITY_PRODUCTION_URL : LEEGALITY_SANDBOX_URL,
    ...(fetch ? { fetch } : {}),
  });
}

function fromPlatform(config: LeegalityConfig, fetch?: FetchLike): EsignProvider {
  return createLeegalityProvider({
    authToken: config.authToken,
    privateSalt: config.privateSalt,
    profileId: config.workflowId,
    environment: config.environment,
    baseUrl: config.baseUrl,
    ...(config.webhookHeader ? { webhookHeader: config.webhookHeader } : {}),
    ...(fetch ? { fetch } : {}),
  });
}

/** A provider for credentials typed into the settings form, to try them before saving. */
export const providerForCredentials = (credentials: OwnCredentials, fetch?: FetchLike) =>
  fromOwn(credentials, fetch);

type Hold = 'none' | 'held' | 'consumed' | 'released';

async function holdOf(sql: Sql, input: { workspaceId: string; ref: string }): Promise<Hold> {
  const rows = await sql<{ kind: string }[]>`
    select kind from app_esign_credit_ledger
    where workspace_id = ${input.workspaceId} and ref = ${input.ref}`;
  const kinds = new Set(rows.map((row) => row.kind));
  if (kinds.has('consume')) return 'consumed';
  if (kinds.has('release')) return 'released';
  return kinds.has('reserve') ? 'held' : 'none';
}

/**
 * Spends the credit of a signed eSign, once however often it is asked. When the hold was
 * already given back (the signature came after the wait ended) it takes a credit again under
 * a second reference. False when the workspace has none left; the balance never goes negative.
 */
async function spend(sql: Sql, hold: { workspaceId: string; ref: string }): Promise<boolean> {
  const first = await holdOf(sql, hold);
  if (first === 'consumed') return true;
  if (first === 'held') return (await consumeCredit(sql, hold)) || (await holdOf(sql, hold)) === 'consumed';
  const late = { workspaceId: hold.workspaceId, ref: `${hold.ref}:late` };
  if ((await holdOf(sql, late)) === 'consumed') return true;
  if (!(await reserveCredit(sql, late))) return false;
  return (await consumeCredit(sql, late)) || (await holdOf(sql, late)) === 'consumed';
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Wires Aadhaar eSign into the sign server: which provider account a workspace signs with,
 * whether it may start one now, and the prepaid credit an eSign on the install's account
 * holds, spends or gets back.
 */
export function createEsignOptions(deps: EsignRuntimeDeps): EsignOptions {
  const { sql } = deps;
  const cache = new Map<string, { key: string; provider: EsignProvider }>();

  async function provider(workspaceId: string): Promise<EsignProvider | null> {
    const saved = await getEsignSettings(sql, workspaceId);
    if (saved.mode === 'own') {
      const entitlements = await workspaceEntitlements(sql, workspaceId);
      if (!entitlements.ownEsignAccount) return null;
      const key = `own:${saved.version}`;
      const hit = cache.get(workspaceId);
      if (hit?.key === key) return hit.provider;
      const credentials = await ownCredentials(sql, workspaceId);
      if (!credentials) return null;
      const made = fromOwn(credentials, deps.fetch);
      cache.set(workspaceId, { key, provider: made });
      return made;
    }
    const config = safeConfig(deps)?.leegality;
    if (!config) return null;
    const key = `platform:${digest(config)}`;
    const hit = cache.get('');
    if (hit?.key === key) return hit.provider;
    const made = fromPlatform(config, deps.fetch);
    cache.set('', { key, provider: made });
    return made;
  }

  async function available(workspaceId: string): Promise<EsignUnavailable | null> {
    const { blocked } = await esignState(deps, workspaceId);
    return blocked ? { ...blocked, signerMessage: SIGNER_NO_CREDITS } : null;
  }

  return {
    provider,
    available,

    async onStart(input) {
      const state = await esignState(deps, input.workspaceId);
      const billed = state.mode === 'platform' && state.creditsRequired;
      if (billed && !(await reserveCredit(sql, input))) {
        throw new SignError('ESIGN_UNAVAILABLE', SIGNER_NO_CREDITS, { reason: 'no_credits' });
      }
      await recordEsignStart(sql, { ...input, mode: state.mode, billed });
      await recordAudit(sql, {
        workspaceId: input.workspaceId,
        action: 'esign.started',
        target: input.envelopeId,
        data: { ref: input.ref, recipientId: input.recipientId, mode: state.mode },
      });
    },

    async onEnd(input) {
      const usage = await getEsignUsage(sql, input.ref);
      if (!usage || usage.workspaceId !== input.workspaceId) return;
      const hold = { workspaceId: input.workspaceId, ref: input.ref };
      const data = { ref: input.ref, recipientId: input.recipientId, mode: usage.mode };
      if (usage.billed && input.outcome !== 'signed') await releaseCredit(sql, hold);
      if (usage.billed && input.outcome === 'signed' && !(await spend(sql, hold))) {
        if (await markUnbilled(sql, input.ref)) {
          await recordAudit(sql, {
            workspaceId: input.workspaceId,
            action: 'esign.unbilled',
            target: input.envelopeId,
            data,
          });
        }
      }
      if (await recordEsignOutcome(sql, input.ref, input.outcome)) {
        await recordAudit(sql, {
          workspaceId: input.workspaceId,
          action: input.outcome === 'signed' ? 'esign.completed' : 'esign.failed',
          target: input.envelopeId,
          data: { ...data, outcome: input.outcome },
        });
      }
    },
  };
}
