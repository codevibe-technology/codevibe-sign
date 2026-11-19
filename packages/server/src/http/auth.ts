import { createHash, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from '../crypto';
import { HttpError } from '../errors';
import type { ApiKey } from '../options';
import { DEFAULT_WORKSPACE, type Principal } from '../tenancy';

/** A configured key as the server keeps it: only the SHA-256 of the secret. */
export interface StoredApiKey {
  id: string;
  sha256: Buffer;
  workspaceId: string;
}

const MIN_KEY_LENGTH = 16;

/**
 * Hashes every plain key at start-up, so the secrets themselves are not kept in memory. An empty
 * list is allowed only when another authenticator resolves callers.
 */
export function normalizeApiKeys(keys: (ApiKey | string)[], allowEmpty = false): StoredApiKey[] {
  if (keys.length === 0 && !allowEmpty) throw new Error('At least one API key is required');
  return keys.map((entry) => {
    const workspaceId =
      typeof entry === 'string' ? DEFAULT_WORKSPACE : (entry.workspaceId ?? DEFAULT_WORKSPACE);
    if (!workspaceId) throw new Error('workspaceId must not be empty');
    if (typeof entry === 'string' || 'key' in entry) {
      const secret = typeof entry === 'string' ? entry : entry.key;
      const id = typeof entry === 'string' ? `key_${sha256Hex(secret).slice(0, 12)}` : entry.id;
      if (secret.length < MIN_KEY_LENGTH) {
        throw new Error(`API key ${id} is too short (${MIN_KEY_LENGTH} characters minimum)`);
      }
      return { id, sha256: createHash('sha256').update(secret).digest(), workspaceId };
    }
    if (!/^[0-9a-f]{64}$/i.test(entry.sha256)) {
      throw new Error(`API key ${entry.id} needs sha256 as 64 hex characters`);
    }
    return { id: entry.id, sha256: Buffer.from(entry.sha256, 'hex'), workspaceId };
  });
}

/**
 * Returns the principal of the key in `Authorization: Bearer <key>`. The presented key is hashed
 * and compared with every configured hash in constant time, so timing reveals neither which keys
 * exist nor how much of one matched.
 */
export function authenticate(header: string | undefined, keys: StoredApiKey[]): Principal {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  if (!match?.[1]) {
    throw new HttpError('UNAUTHORIZED', 'Send an API key as Authorization: Bearer <key>');
  }
  const presented = createHash('sha256').update(match[1]).digest();
  let found: StoredApiKey | undefined;
  for (const key of keys) {
    if (timingSafeEqual(presented, key.sha256) && found === undefined) found = key;
  }
  if (found === undefined) throw new HttpError('UNAUTHORIZED', 'The API key is not valid');
  return { id: found.id, workspaceId: found.workspaceId };
}
