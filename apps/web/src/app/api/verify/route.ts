import { memoryRateLimiter } from '@codevibe_technology/sign-server';
import { MAX_PDF_BYTES } from '@/lib/send-flow';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { AppError } from '@/server/errors';
import { verifyUpload } from '@/server/pdf';
import { sealedEvidence } from '@/server/public-verify';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60 * 1000;
/** Checks per client address in ten minutes, and for everyone together when the address is unknown. */
const PER_CLIENT = 30;
const SHARED = 300;

const holder = globalThis as unknown as {
  __cvsVerifyLimiter?: ReturnType<typeof memoryRateLimiter>;
};
const limiter = () => (holder.__cvsVerifyLimiter ??= memoryRateLimiter({ maxKeys: 10_000 }));

/** The address added by the proxy in front of the app, when the app is told to trust it. */
function clientKey(request: Request): string | null {
  if (!env().TRUST_PROXY) return null;
  const entries = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? null;
}

const problem = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * The public verify page posts a PDF here. The file is read in memory, checked against this
 * install's seal certificate and dropped; nothing about it is written anywhere. When the
 * seal is valid and the file is one this install sealed, the signers and the audit trail
 * come back too: the same facts the certificate page inside the file already shows.
 */
export async function POST(request: Request) {
  const key = clientKey(request);
  const limit = await limiter().hit(
    key ? `ip:${key}` : 'shared',
    key ? PER_CLIENT : SHARED,
    WINDOW_MS,
    new Date(),
  );
  if (!limit.allowed) {
    return problem(429, 'Too many checks from here. Wait a few minutes and try again.');
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_PDF_BYTES + 64 * 1024) {
    return problem(413, `The file is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    file = null;
  }
  if (!(file instanceof File)) return problem(400, 'Choose a PDF file to check.');
  try {
    const outcome = await verifyUpload(new Uint8Array(await file.arrayBuffer()), 'install');
    const evidence = outcome.valid ? await sealedEvidence(db(), outcome.sha256) : null;
    return Response.json({
      ok: true,
      data: { ...outcome, fileName: file.name.slice(0, 200), evidence },
    });
  } catch (err) {
    if (err instanceof AppError) return problem(err.code === 'VALIDATION' ? 400 : 409, err.message);
    console.error('[verify] failed', err instanceof Error ? err.message : err);
    return problem(500, 'Something went wrong on our side. Try again in a moment.');
  }
}
