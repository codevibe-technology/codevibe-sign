import { SignError } from '@codevibe_technology/sign-core';
import type { StandaloneConfig } from './node';

export interface EnvConfig {
  server: StandaloneConfig;
  /** Read the client IP from `X-Forwarded-For`; only behind a proxy you control. */
  trustProxy: boolean;
  /** Proxies in front of the server that append to `X-Forwarded-For`. */
  trustedProxyHops: number;
  port: number;
  host: string;
}

export type EnvVars = Record<string, string | undefined>;

const MIN_API_KEY_LENGTH = 32;

/** Reads and validates every variable, then reports all problems at once by variable name. */
export function configFromEnv(env: EnvVars): EnvConfig {
  const problems: string[] = [];

  function need(name: string): string {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(`${name} is required`);
      return '';
    }
    return value;
  }

  function integer(name: string, fallback: number, min: number, max: number): number {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return value;
  }

  const databaseUrl = need('DATABASE_URL');
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgres:// or postgresql:// URL');
  }

  const publicUrl = need('PUBLIC_URL').replace(/\/+$/, '');
  if (publicUrl) {
    let url: URL | undefined;
    try {
      url = new URL(publicUrl);
    } catch {
      problems.push('PUBLIC_URL must be an absolute URL');
    }
    const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url && url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      problems.push('PUBLIC_URL must use https (http is allowed only for localhost)');
    }
  }

  const smtpPort = integer('SMTP_PORT', 587, 1, 65535);
  const smtpUser = env.SMTP_USER?.trim() || undefined;
  const smtpPass = env.SMTP_PASS || undefined;
  if (Boolean(smtpUser) !== Boolean(smtpPass)) {
    problems.push('SMTP_USER and SMTP_PASS must be set together');
  }
  const secureRaw = env.SMTP_SECURE?.trim().toLowerCase();
  if (secureRaw && secureRaw !== 'true' && secureRaw !== 'false') {
    problems.push('SMTP_SECURE must be true or false');
  }
  const smtp: StandaloneConfig['smtp'] = {
    host: need('SMTP_HOST'),
    port: smtpPort,
    secure: secureRaw ? secureRaw === 'true' : smtpPort === 465,
    from: need('SMTP_FROM'),
  };
  if (smtpUser && smtpPass) {
    smtp.user = smtpUser;
    smtp.pass = smtpPass;
  }

  const p12Base64 = need('SEAL_P12_BASE64').replace(/\s+/g, '');
  let p12 = new Uint8Array();
  if (p12Base64) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(p12Base64)) {
      problems.push('SEAL_P12_BASE64 must be base64');
    } else {
      p12 = new Uint8Array(Buffer.from(p12Base64, 'base64'));
    }
  }
  const passphrase = env.SEAL_P12_PASSPHRASE;
  if (passphrase === undefined) problems.push('SEAL_P12_PASSPHRASE is required');

  const tsaUrl = env.SEAL_TSA_URL?.trim() || undefined;
  if (tsaUrl && !/^https?:\/\/[^\s/]+/i.test(tsaUrl)) {
    problems.push('SEAL_TSA_URL must be an http:// or https:// URL');
  }
  const tsaRequiredRaw = env.SEAL_TSA_REQUIRED?.trim().toLowerCase();
  if (tsaRequiredRaw && tsaRequiredRaw !== 'true' && tsaRequiredRaw !== 'false') {
    problems.push('SEAL_TSA_REQUIRED must be true or false');
  }

  const apiKeys = need('API_KEYS')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
  if (env.API_KEYS?.trim() && apiKeys.length === 0) problems.push('API_KEYS has no keys');
  if (apiKeys.some((key) => key.length < MIN_API_KEY_LENGTH)) {
    problems.push(`Each key in API_KEYS must be at least ${MIN_API_KEY_LENGTH} characters`);
  }

  const tickSeconds = integer('TICK_INTERVAL_SECONDS', 60, 5, 3600);

  const trustRaw = env.TRUST_PROXY?.trim().toLowerCase();
  if (trustRaw && trustRaw !== 'true' && trustRaw !== 'false') {
    problems.push('TRUST_PROXY must be true or false');
  }

  const trustedProxyHops = integer('TRUSTED_PROXY_HOPS', 1, 1, 20);

  const port = integer('PORT', 3000, 1, 65535);
  const host = env.HOST?.trim() || '0.0.0.0';

  if (problems.length > 0) {
    throw new SignError('VALIDATION', `Invalid configuration:\n- ${problems.join('\n- ')}`, {
      problems,
    });
  }

  const seal: StandaloneConfig['seal'] = { p12, passphrase: passphrase ?? '' };
  const reason = env.SEAL_REASON?.trim();
  const location = env.SEAL_LOCATION?.trim();
  if (reason) seal.reason = reason;
  if (location) seal.location = location;
  if (tsaUrl) {
    seal.tsaUrl = tsaUrl;
    seal.tsaRequired = tsaRequiredRaw !== 'false';
  }

  return {
    server: {
      databaseUrl,
      filesDir: env.FILES_DIR?.trim() || '/data/files',
      smtp,
      seal,
      apiKeys,
      publicUrl,
      tickIntervalMs: tickSeconds * 1000,
    },
    trustProxy: trustRaw === 'true',
    trustedProxyHops,
    port,
    host,
  };
}
