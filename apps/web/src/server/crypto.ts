import { createHash, randomBytes } from 'node:crypto';

/** A random id with a readable prefix, for example `ws_3f9c...`. */
export const randomId = (prefix: string) => `${prefix}_${randomBytes(10).toString('hex')}`;

/** 32 random bytes as base64url: 43 characters. */
export const randomSecret = () => randomBytes(32).toString('base64url');

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
