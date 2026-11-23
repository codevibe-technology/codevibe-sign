import 'server-only';
import { memoryRateLimiter } from '@codevibe_technology/sign-server';
import type { PublicRecordView } from '@/lib/public-record';
import { clientAddress } from './client-address';
import { db } from './db';
import { AppError } from './errors';
import {
  loadRecordSource,
  publicRecordView,
  type RecordSource,
  type SealAnswer,
  type SealChecker,
} from './public-records';
import { signApi } from './sign/api';

const WINDOW_MS = 10 * 60 * 1000;
/** Views and downloads per client address in ten minutes, and for everyone when it is unknown. */
const PER_CLIENT = 60;
const SHARED = 600;
/** A stored file does not change, so its seal is not checked again on every view. */
const SEAL_CACHE_MS = 10 * 60 * 1000;
const SEAL_CACHE_MAX = 2_000;

const holder = globalThis as unknown as {
  __cvsRecordLimiter?: ReturnType<typeof memoryRateLimiter>;
  __cvsRecordSeals?: Map<string, { at: number; answer: SealAnswer }>;
};

/** False when this visitor has opened too many records lately. */
export async function recordViewAllowed(headers: Headers): Promise<boolean> {
  holder.__cvsRecordLimiter ??= memoryRateLimiter({ maxKeys: 10_000 });
  const key = clientAddress(headers);
  const limit = await holder.__cvsRecordLimiter.hit(
    key ? `record:ip:${key}` : 'record:shared',
    key ? PER_CLIENT : SHARED,
    WINDOW_MS,
    new Date(),
  );
  return limit.allowed;
}

/** Verifies the stored sealed file through the sign server, as the workspace itself would. */
export const checkStoredSeal: SealChecker = async (workspaceId, envelopeId, documentId) => {
  const seals = (holder.__cvsRecordSeals ??= new Map());
  const key = `${envelopeId}/${documentId}`;
  const cached = seals.get(key);
  if (cached && Date.now() - cached.at < SEAL_CACHE_MS) return cached.answer;
  try {
    const check = await signApi({
      id: 'public-record',
      workspaceId,
      readOnly: true,
    }).verification(envelopeId, documentId);
    const answer = { valid: check.valid, sha256: check.sha256, signedAt: check.signedAt };
    if (seals.size >= SEAL_CACHE_MAX) seals.clear();
    seals.set(key, { at: Date.now(), answer });
    return answer;
  } catch (err) {
    if (err instanceof AppError) return null;
    throw err;
  }
};

/** The stored envelope behind a live record link, or null when the link answers "not found". */
export const recordSource = (id: string): Promise<RecordSource | null> =>
  loadRecordSource(db(), id);

export async function recordView(id: string): Promise<PublicRecordView | null> {
  const source = await recordSource(id);
  return source ? publicRecordView(source, checkStoredSeal) : null;
}
