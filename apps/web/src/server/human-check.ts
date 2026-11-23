import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  HUMAN_CHECK_TOKEN_MAX,
  humanCheckMessage,
  type HumanCheckFailure,
} from '@/lib/human-check';
import { clientAddress } from './client-address';
import { env, type Env } from './env';
import { AppError } from './errors';

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long one call to Cloudflare may take before it counts as unanswered. */
export const SITEVERIFY_TIMEOUT_MS = 4_000;

export type HumanCheck = { ok: true } | { ok: false; reason: HumanCheckFailure };

export interface VerifyTurnstileInput {
  secret: string;
  token: string | null | undefined;
  /** The visitor's address, when the app knows it. Cloudflare compares it with the solver's. */
  remoteIp?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  idempotencyKey?: string;
}

/** Error codes that mean this install's own keys are wrong, not the visitor's token. */
const CONFIG_ERRORS = new Set(['missing-input-secret', 'invalid-input-secret']);

interface SiteverifyAnswer {
  success?: unknown;
  'error-codes'?: unknown;
}

const codesOf = (answer: SiteverifyAnswer): string[] =>
  Array.isArray(answer['error-codes'])
    ? answer['error-codes'].filter((code): code is string => typeof code === 'string')
    : [];

/**
 * Asks Cloudflare whether a Turnstile token is good. A call that fails or times out is made
 * once more with the same idempotency key, so the retry cannot be refused as a token used
 * twice. Anything short of a clear yes is a no: the check fails closed.
 */
export async function verifyTurnstile(input: VerifyTurnstileInput): Promise<HumanCheck> {
  const token = input.token?.trim() ?? '';
  if (!token) return { ok: false, reason: 'missing' };
  if (token.length > HUMAN_CHECK_TOKEN_MAX) return { ok: false, reason: 'rejected' };

  const send = input.fetch ?? fetch;
  const body = new URLSearchParams({
    secret: input.secret,
    response: token,
    idempotency_key: input.idempotencyKey ?? randomUUID(),
  });
  if (input.remoteIp) body.set('remoteip', input.remoteIp);

  for (let attempt = 0; attempt < 2; attempt++) {
    let answer: SiteverifyAnswer;
    try {
      const response = await send(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(input.timeoutMs ?? SITEVERIFY_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      answer = (await response.json()) as SiteverifyAnswer;
    } catch {
      continue;
    }
    if (answer.success === true) return { ok: true };
    const codes = codesOf(answer);
    if (codes.includes('internal-error')) continue;
    if (codes.some((code) => CONFIG_ERRORS.has(code))) {
      console.error('[turnstile] the secret key was refused; check TURNSTILE_SECRET_KEY');
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: false, reason: 'rejected' };
  }
  return { ok: false, reason: 'unavailable' };
}

/** Both keys, or null when the human check is off for this install. */
export function turnstileKeys(config: Env): { siteKey: string; secretKey: string } | null {
  if (!config.TURNSTILE_SITE_KEY || !config.TURNSTILE_SECRET_KEY) return null;
  return { siteKey: config.TURNSTILE_SITE_KEY, secretKey: config.TURNSTILE_SECRET_KEY };
}

/** The key the browser widget needs, or null when the check is off. */
export function turnstileSiteKey(): string | null {
  return turnstileKeys(env())?.siteKey ?? null;
}

/** Checks a request's token; always passes when the check is off. */
export async function checkHuman(
  token: string | null | undefined,
  headers: Headers,
): Promise<HumanCheck> {
  const keys = turnstileKeys(env());
  if (!keys) return { ok: true };
  return verifyTurnstile({ secret: keys.secretKey, token, remoteIp: clientAddress(headers) });
}

/** For server actions: stops with a message the form can show when the check fails. */
export async function requireHuman(token: string | null | undefined, headers: Headers) {
  const result = await checkHuman(token, headers);
  if (!result.ok) throw new AppError('HUMAN_CHECK', humanCheckMessage(result.reason));
}
