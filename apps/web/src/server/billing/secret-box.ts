import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const LABEL = 'codevibe-sign/secret-box/v1';

/**
 * The key secrets are sealed with: `SECRETS_KEY` when set, otherwise derived from `AUTH_SECRET`.
 * Changing either makes everything sealed so far unreadable.
 */
function key(source: Record<string, string | undefined>): Buffer {
  const own = source.SECRETS_KEY?.trim();
  if (own !== undefined && own !== '' && own.length < 32) {
    throw new Error('SECRETS_KEY must be at least 32 characters');
  }
  const material = own || source.AUTH_SECRET;
  if (!material || material.length < 32) {
    throw new Error('AUTH_SECRET (or SECRETS_KEY) must be set to at least 32 characters');
  }
  return Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), LABEL, 32));
}

/**
 * Encrypts a secret for storage (AES-256-GCM). `context` says what the secret is and whose,
 * for example `ws_123:leegality.authToken`; it is bound to the result, so a sealed value moved
 * to another row or column does not open.
 */
export function sealSecret(
  plaintext: string,
  context: string,
  source: Record<string, string | undefined> = process.env,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(source), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Opens a value from `sealSecret`. Throws when it was changed, moved or sealed with another key. */
export function openSecret(
  sealed: string,
  context: string,
  source: Record<string, string | undefined> = process.env,
): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || body === undefined) {
    throw new Error('The stored secret is not in a known format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(source), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('The stored secret could not be opened');
  }
}
