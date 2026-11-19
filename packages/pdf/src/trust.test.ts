import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';
import { SignError } from '@codevibe/sign-core';
import { seal } from './seal';
import { createTestCa, createTestP12, type TestCa, type TestP12 } from './testing/p12';
import { A4, makePdf } from './testing/fixtures';
import { sealCertificate, verify } from './trust';

let operator: TestP12;
let stranger: TestP12;
let root: TestCa;
let issued: TestP12;
let sealed: Uint8Array;
let sealedByStranger: Uint8Array;
let sealedByIssued: Uint8Array;

const pemToDer = (pem: string) =>
  new Uint8Array(
    Buffer.from(
      forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(),
      'binary',
    ),
  );

beforeAll(async () => {
  operator = createTestP12({ commonName: 'Operator Seal' });
  stranger = createTestP12({ commonName: 'Operator Seal' });
  root = createTestCa();
  issued = createTestP12({ commonName: 'Issued Seal', issuer: root });
  const pdf = await makePdf([{ size: A4 }]);
  sealed = await seal(pdf, { p12: operator.p12, passphrase: operator.passphrase });
  sealedByStranger = await seal(pdf, { p12: stranger.p12, passphrase: stranger.passphrase });
  sealedByIssued = await seal(pdf, { p12: issued.p12, passphrase: issued.passphrase });
});

describe('verify', () => {
  it('accepts a file sealed with the trusted operator certificate', async () => {
    const result = await verify(sealed, { trust: { certificates: [operator.certificatePem] } });
    expect(result).toMatchObject({
      valid: true,
      trustedBy: 'certificate',
      signer: { commonName: 'Operator Seal' },
    });
    expect(result.reason).toBeUndefined();
    expect(result.certificateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.seal).toMatchObject({ valid: true, coversWholeDocument: true });
  });

  it('accepts the certificate as DER or as a fingerprint in any case', async () => {
    const der = pemToDer(operator.certificatePem);
    expect((await verify(sealed, { trust: { certificates: [der] } })).valid).toBe(true);
    const { sha256 } = sealCertificate({ p12: operator.p12, passphrase: operator.passphrase });
    const colons = sha256.toUpperCase().match(/../g)!.join(':');
    expect((await verify(sealed, { trust: { fingerprints: [colons] } })).valid).toBe(true);
  });

  it('rejects a valid seal made with someone else’s key', async () => {
    const result = await verify(sealedByStranger, {
      trust: { certificates: [operator.certificatePem] },
    });
    expect(result.seal.valid).toBe(true);
    expect(result).toMatchObject({ valid: false, reason: 'untrusted_signer' });
  });

  it('accepts a certificate issued by a trusted root, and only that root', async () => {
    const trusted = await verify(sealedByIssued, { trust: { roots: [root.certificatePem] } });
    expect(trusted).toMatchObject({ valid: true, trustedBy: 'root' });
    const otherRoot = createTestCa('Other Root');
    const untrusted = await verify(sealedByIssued, {
      trust: { roots: [otherRoot.certificatePem] },
    });
    expect(untrusted).toMatchObject({ valid: false, reason: 'untrusted_signer' });
    const selfSigned = await verify(sealed, { trust: { roots: [root.certificatePem] } });
    expect(selfSigned).toMatchObject({ valid: false, reason: 'untrusted_signer' });
  });

  it('rejects changes, appended bytes, extra signatures and unsealed files', async () => {
    const trust = { certificates: [operator.certificatePem] };
    const changed = new Uint8Array(sealed);
    changed[100] = changed[100] === 0x30 ? 0x31 : 0x30;
    expect(await verify(changed, { trust })).toMatchObject({ valid: false });

    const appended = new Uint8Array(Buffer.concat([Buffer.from(sealed), Buffer.from('\n%x\n')]));
    expect(await verify(appended, { trust })).toMatchObject({
      valid: false,
      reason: 'not_whole_document',
    });

    const twice = await seal(sealed, { p12: operator.p12, passphrase: operator.passphrase });
    expect(await verify(twice, { trust })).toMatchObject({
      valid: false,
      reason: 'multiple_signatures',
    });

    const plain = await makePdf([{ size: A4 }]);
    expect(await verify(plain, { trust })).toMatchObject({ valid: false, reason: 'not_sealed' });
  });

  it('refuses to run without anything to trust', async () => {
    const error = await verify(sealed, { trust: {} }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SignError);
    expect((error as SignError).code).toBe('VALIDATION');
  });
});

describe('sealCertificate', () => {
  it('returns the operator certificate and its fingerprint', () => {
    const info = sealCertificate({ p12: operator.p12, passphrase: operator.passphrase });
    expect(info.pem).toBe(operator.certificatePem);
    expect(info.subject.commonName).toBe('Operator Seal');
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies the same key checks as seal()', () => {
    const weak = createTestP12({ bits: 1024 });
    expect(() => sealCertificate({ p12: weak.p12, passphrase: weak.passphrase })).toThrow(/2048/);
    expect(
      sealCertificate({ p12: weak.p12, passphrase: weak.passphrase, allowWeakKey: true }).sha256,
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});
