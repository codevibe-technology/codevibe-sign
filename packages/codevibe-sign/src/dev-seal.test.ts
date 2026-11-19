import { seal, sealCertificate, verify } from '@codevibe_technology/sign-pdf';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { createDevSeal } from './dev-seal';

describe('createDevSeal', () => {
  it('creates an RSA-2048 seal that seal() and verify() accept', async () => {
    const dev = createDevSeal({ commonName: 'Acme HR', organization: 'Acme', passphrase: 'pw' });
    const certificate = sealCertificate({ p12: dev.p12, passphrase: 'pw' });
    expect(certificate.subject).toEqual({ commonName: 'Acme HR', organization: 'Acme' });
    expect(certificate.sha256).toBe(dev.sha256);

    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    const sealed = await seal(await doc.save(), { p12: dev.p12, passphrase: 'pw' });
    const result = await verify(sealed, { trust: { certificates: [dev.certificatePem] } });
    expect(result).toMatchObject({ valid: true, certificateSha256: dev.sha256 });
  });

  it('generates a passphrase and sets the validity window', () => {
    const notBefore = new Date('2026-01-01T00:00:00Z');
    const dev = createDevSeal({ days: 10, notBefore });
    expect(dev.passphrase.length).toBeGreaterThanOrEqual(20);
    expect(dev.notAfter.toISOString()).toBe('2026-01-11T00:00:00.000Z');
    expect(() => sealCertificate({ p12: dev.p12, passphrase: 'wrong' })).toThrow();
    expect(createDevSeal().passphrase).not.toBe(dev.passphrase);
  });

  it.each([0, 3651, 1.5])('rejects %s days', (days) => {
    expect(() => createDevSeal({ days })).toThrow(RangeError);
  });
});
