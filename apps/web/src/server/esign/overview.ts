import 'server-only';
import type postgres from 'postgres';
import type { Paise } from '@/lib/billing/money';
import { billingVisible } from '@/lib/plans';
import { billingConfig, creditsOffer, type BillingConfig } from '../billing/config';
import { creditBalance, type CreditBalance } from '../billing/credits';
import { planSettings, workspaceEntitlements } from '../plans';
import { esignState } from './runtime';
import { getEsignSettings, type EsignSettings } from './settings';
import { listEsignUsage, type EsignUsageLine } from './usage';

type Sql = postgres.Sql;

/** What the Aadhaar eSign settings page shows. Plain data with no credential in it. */
export interface EsignOverview {
  settings: EsignSettings;
  /** Null when an eSign can be started now; otherwise why not, for the sender. */
  blocked: { reason: string; message: string } | null;
  /** The install's own provider account is set up. */
  platformConfigured: boolean;
  /** eSigns on the install's account use prepaid credits. */
  creditsRequired: boolean;
  /** Credits and billing exist on this install. */
  billingVisible: boolean;
  /** The plan lets the workspace connect its own provider account. */
  ownAllowed: boolean;
  credits: CreditBalance;
  /** Price of one eSign before tax; null shows as "Price coming soon". */
  pricePaise: Paise | null;
  testMode: boolean;
  /** The install's provider account is its sandbox: signatures there have no legal effect. */
  sandbox: boolean;
  usage: EsignUsageLine[];
  /** What to paste into the provider's workflow. */
  webhookUrl: string;
  redirectUrl: string;
}

function readConfig(): BillingConfig | null {
  try {
    return billingConfig();
  } catch {
    return null;
  }
}

export async function esignOverview(
  sql: Sql,
  input: { workspaceId: string; appUrl: string },
): Promise<EsignOverview> {
  const settings = planSettings();
  const config = readConfig();
  const [saved, entitlements, state, credits, usage] = await Promise.all([
    getEsignSettings(sql, input.workspaceId),
    workspaceEntitlements(sql, input.workspaceId, settings),
    esignState({ sql }, input.workspaceId),
    creditBalance(sql, input.workspaceId),
    listEsignUsage(sql, input.workspaceId),
  ]);
  const offer = config ? creditsOffer(config, entitlements.plan) : null;
  return {
    settings: saved,
    blocked: state.blocked,
    platformConfigured: Boolean(config?.leegality),
    creditsRequired: billingVisible(settings),
    billingVisible: billingVisible(settings),
    ownAllowed: entitlements.ownEsignAccount,
    credits,
    pricePaise: offer?.pricePaise ?? null,
    testMode: offer?.testMode ?? false,
    sandbox: config?.leegality?.environment === 'sandbox',
    usage,
    webhookUrl: `${input.appUrl}/api/v1/esign/webhooks/leegality`,
    redirectUrl: `${input.appUrl}/sign?esign=return`,
  };
}

/** What the send flow needs to offer Aadhaar eSign for a signer. */
export interface EsignSendInfo {
  available: boolean;
  /** Why not, for the sender, when it is not available. */
  reason: string | null;
  message: string | null;
  creditsRequired: boolean;
  credits: number;
  pricePaise: Paise | null;
}

export async function esignSendInfo(sql: Sql, workspaceId: string): Promise<EsignSendInfo> {
  const settings = planSettings();
  const config = readConfig();
  const [state, entitlements, credits] = await Promise.all([
    esignState({ sql }, workspaceId),
    workspaceEntitlements(sql, workspaceId, settings),
    creditBalance(sql, workspaceId),
  ]);
  const billed = state.mode === 'platform' && state.creditsRequired;
  return {
    available: state.blocked === null,
    reason: state.blocked?.reason ?? null,
    message: state.blocked?.message ?? null,
    creditsRequired: billed,
    credits: credits.available,
    pricePaise: billed && config ? creditsOffer(config, entitlements.plan).pricePaise : null,
  };
}
