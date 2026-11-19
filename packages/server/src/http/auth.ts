import { constantTimeEqual, sha256Hex } from '../crypto';
import { HttpError } from '../errors';
import type { ApiKey } from '../options';

export function normalizeApiKeys(keys: (ApiKey | string)[]): ApiKey[] {
  if (keys.length === 0) throw new Error('At least one API key is required');
  return keys.map((entry) => {
    const key =
      typeof entry === 'string'
        ? { id: `key_${sha256Hex(entry).slice(0, 12)}`, key: entry }
        : entry;
    if (key.key.length < 16)
      throw new Error(`API key ${key.id} is too short (16 characters minimum)`);
    return key;
  });
}

/**
 * Returns the id of the key in `Authorization: Bearer <key>`. Every configured key is
 * compared, in constant time, so timing does not reveal which keys exist.
 */
export function authenticate(header: string | undefined, keys: ApiKey[]): string {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  if (!match?.[1]) {
    throw new HttpError('UNAUTHORIZED', 'Send an API key as Authorization: Bearer <key>');
  }
  const presented = match[1];
  let found: string | undefined;
  for (const key of keys) {
    if (constantTimeEqual(presented, key.key) && found === undefined) found = key.id;
  }
  if (found === undefined) throw new HttpError('UNAUTHORIZED', 'The API key is not valid');
  return found;
}
