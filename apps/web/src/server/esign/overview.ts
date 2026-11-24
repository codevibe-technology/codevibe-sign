import 'server-only';
import type postgres from 'postgres';
import {
  LEEGALITY_DEFAULT_COORDINATES,
  describeLeegalityCoordinates,
} from '@codevibe_technology/sign-aadhaar';
import type { Paise } from '@/lib/billing/money';
import { billingVisible } from '@/lib/plans';
import { accountIdOfWorkspace } from '../accounts';
import { billingConfig, creditsOffer, type BillingConfig } from '../billing/config';
import { creditBalance, type CreditBalance } from '../billing/credits';
import { planSettings, workspaceEntitlements } from '../plans';
import { esignState } from './runtime';
import { ownPositionApi, type PositionApi } from './leegality-v4';
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
  /** Which Leegality API places the Aadhaar seal position on the install's account. */
  platformPositionApi: PositionApi;
  /** The same for the workspace's own account, from what it saved. */
  ownPositionApi: PositionApi;
  /** How the install turns a seal position into Leegality coordinates, e.g. "points, bottom-left". */
  coordinates: string;
  /** eSigns on the install's account use prepaid credits. */
  creditsRequired: boolean;
  /** Credits and billing exist on this install. */
  billingVisible: boolean;
  /** The plan lets the account connect its own provider account. */
  ownAllowed: boolean;
  credits: CreditBalance;
  /** eSigns signed with no credit left; new credits pay for these first. */
  owed: number;
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
  input: {
    workspaceId: string;
    appUrl: string;
    /** The reader owns the account, so they see the eSigns of all its workspaces. */
    wholeAccount?: boolean;
  },
): Promise<EsignOverview> {
  const settings = planSettings();
  const config = readConfig();
  const accountId = await accountIdOfWorkspace(sql, input.workspaceId);
  const [saved, entitlements, state, credits, usage] = await Promise.all([
    getEsignSettings(sql, accountId),
    workspaceEntitlements(sql, input.workspaceId, settings),
    esignState({ sql }, input.workspaceId),
    creditBalance(sql, accountId),
    listEsignUsage(sql, accountId, 20, input.wholeAccount ? undefined : input.workspaceId),
  ]);
  const offer = config ? creditsOffer(config, entitlements.plan) : null;
  return {
    settings: saved,
    blocked: state.blocked,
    platformConfigured: Boolean(config?.leegality),
    platformPositionApi: config?.leegality?.positionApi ?? 'v2.1',
    ownPositionApi: ownPositionApi(saved.own.v4Workflow),
    coordinates: describeLeegalityCoordinates(
      config?.leegality?.coordinates ?? LEEGALITY_DEFAULT_COORDINATES,
    ),
    creditsRequired: billingVisible(settings),
    billingVisible: billingVisible(settings),
    ownAllowed: entitlements.ownEsignAccount,
    credits,
    owed: state.owed,
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
  /**
   * The account the workspace signs with places the Aadhaar seal position (its position API
   * is not `off`). Otherwise the box is still kept, and Leegality places the signature where
   * its workflow says.
   */
  sealPosition: boolean;
}

export async function esignSendInfo(sql: Sql, workspaceId: string): Promise<EsignSendInfo> {
  const settings = planSettings();
  const config = readConfig();
  const accountId = await accountIdOfWorkspace(sql, workspaceId);
  const [state, entitlements, credits, saved] = await Promise.all([
    esignState({ sql }, workspaceId),
    workspaceEntitlements(sql, workspaceId, settings),
    creditBalance(sql, accountId),
    getEsignSettings(sql, accountId),
  ]);
  const billed = state.mode === 'platform' && state.creditsRequired;
  return {
    available: state.blocked === null,
    reason: state.blocked?.reason ?? null,
    message: state.blocked?.message ?? null,
    creditsRequired: billed,
    credits: credits.available,
    pricePaise: billed && config ? creditsOffer(config, entitlements.plan).pricePaise : null,
    sealPosition:
      (state.mode === 'own'
        ? ownPositionApi(saved.own.v4Workflow)
        : (config?.leegality?.positionApi ?? 'v2.1')) !== 'off',
  };
}
