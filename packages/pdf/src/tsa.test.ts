import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignError } from '@codevibe_technology/sign-core';
import { seal } from './seal';
import { A4, makePdf } from './testing/fixtures';
import { createTestP12, type TestP12 } from './testing/p12';
import { startFakeTsa, type FakeTsa, type FakeTsaMode } from './testing/tsa';
import { verify } from './trust';
import { requestTimestamp, timestampInfo } from './tsa';
import { verifySeal } from './verify';

let tsa: FakeTsa;
let identity: TestP12;
let pdf: Uint8Array;

beforeAll(async () => {
  tsa = await startFakeTsa();
  identity = createTestP12({ commonName: 'Timestamped Seal' });
  pdf = await makePdf([{ size: A4 }]);
});

afterAll(async () => {
  await tsa.close();
});

async function rejection(promise: Promise<unknown>): Promise<SignError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignError);
  return error as SignError;
}

async function withMode<T>(mode: FakeTsaMode, run: () => Promise<T>): Promise<T> {
  tsa.mode = mode;
  try {
    return await run();
  } finally {
    tsa.mode = 'ok';
  }
}

describe('requestTimestamp', () => {
  it('returns a token over the SHA-256 of the data, with the authority time', async () => {
    const token = await requestTimestamp(tsa.url, new TextEncoder().encode('signature'));
    const info = timestampInfo(token);
    expect(info.genTime).toBe(tsa.genTime.toISOString());
    expect(Buffer.from(info.hashedMessage, 'binary').toString('hex')).toBe(
      createHash('sha256').update('signature').digest('hex'),
    );
    expect(info.nonce).toBeDefined();
  });

  it.each<[FakeTsaMode, RegExp]>([
    ['rejected', /refused the request: policy not accepted/],
    ['wrong-nonce', /nonce/],
    ['wrong-imprint', /message imprint/],
    ['bad-signature', /signature is not valid/],
    ['http-error', /HTTP 500/],
    ['garbage', /not DER/],
  ])('refuses a %s answer', async (mode, message) => {
    const error = await withMode(mode, () =>
      rejection(requestTimestamp(tsa.url, new Uint8Array([1]))),
    );
    expect(error.code).toBe('SEAL_FAILED');
    expect(error.message).toMatch(message);
    expect(error.details).toMatchObject({ option: 'tsaUrl' });
  });

  it('refuses an unreachable authority and a URL that is not http', async () => {
    const closed = await startFakeTsa();
    await closed.close();
    const unreachable = await rejection(requestTimestamp(closed.url, new Uint8Array([1])));
    expect(unreachable.message).toMatch(/could not be reached/);
    const scheme = await rejection(requestTimestamp('file:///etc/passwd', new Uint8Array([1])));
    expect(scheme.message).toMatch(/http/);
  });
});

describe('seal with a timestamp authority', () => {
  it('adds a signature timestamp (PAdES B-T) that verify reads back', async () => {
    const sealed = await seal(pdf, {
      p12: identity.p12,
      passphrase: identity.passphrase,
      tsaUrl: tsa.url,
    });
    const result = await verifySeal(sealed);
    expect(result).toMatchObject({
      valid: true,
      coversWholeDocument: true,
      timestampedAt: tsa.genTime.toISOString(),
    });
    const trusted = await verify(sealed, { trust: { certificates: [identity.certificatePem] } });
    expect(trusted.valid).toBe(true);
    expect(trusted.seal.timestampedAt).toBe(tsa.genTime.toISOString());
  });

  it('leaves the timestamp out when no authority is configured', async () => {
    const sealed = await seal(pdf, { p12: identity.p12, passphrase: identity.passphrase });
    expect((await verifySeal(sealed)).timestampedAt).toBeUndefined();
  });

  it('fails closed by default when the authority fails', async () => {
    const before = tsa.requests;
    const error = await withMode('wrong-nonce', () =>
      rejection(seal(pdf, { p12: identity.p12, passphrase: identity.passphrase, tsaUrl: tsa.url })),
    );
    expect(error.code).toBe('SEAL_FAILED');
    expect(tsa.requests).toBe(before + 1);
  });

  it('seals without a timestamp when it is optional, and reports why', async () => {
    const failures: SignError[] = [];
    const sealed = await withMode('http-error', () =>
      seal(pdf, {
        p12: identity.p12,
        passphrase: identity.passphrase,
        tsaUrl: tsa.url,
        tsaRequired: false,
        onTimestampFailure: (error) => failures.push(error),
      }),
    );
    const result = await verifySeal(sealed);
    expect(result.valid).toBe(true);
    expect(result.timestampedAt).toBeUndefined();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/HTTP 500/);
  });

  it('does not report a timestamp that was changed after the authority signed it', async () => {
    const sealed = await seal(pdf, {
      p12: identity.p12,
      passphrase: identity.passphrase,
      tsaUrl: tsa.url,
    });
    const text = Buffer.from(sealed).toString('latin1');
    const genTime = Buffer.from(
      tsa.genTime.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z',
    ).toString('hex');
    const at = text.indexOf(genTime);
    expect(at).toBeGreaterThan(0);
    const changed = new Uint8Array(sealed);
    changed[at + 1] = changed[at + 1] === 0x30 ? 0x31 : 0x30;
    const result = await verifySeal(changed);
    expect(result.valid).toBe(true);
    expect(result.timestampedAt).toBeUndefined();
  });
});
