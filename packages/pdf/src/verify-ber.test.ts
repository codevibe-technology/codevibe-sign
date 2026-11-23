import { beforeAll, describe, expect, it } from 'vitest';
import { seal } from './seal';
import { A4, makePdf } from './testing/fixtures';
import { createTestP12, type TestP12 } from './testing/p12';
import { verifySeal, verifySignatures } from './verify';
import { toIndefiniteLength } from './testing/ber';

let p12: TestP12;
let sealed: Uint8Array;

beforeAll(async () => {
  p12 = createTestP12({ commonName: 'Asha Rao', organization: 'Test eSign Provider' });
  sealed = await seal(await makePdf([{ size: A4 }]), {
    p12: p12.p12,
    passphrase: p12.passphrase,
    reason: 'Signed',
    signingTime: new Date('2026-11-24T10:00:00.000Z'),
  });
});

describe('signatures with an indefinite length', () => {
  it('reads a provider signature written in BER as valid', async () => {
    const ber = toIndefiniteLength(sealed);
    const [signature] = await verifySignatures(ber);
    expect(signature?.valid).toBe(true);
    expect(signature?.coversWholeDocument).toBe(true);
    expect(signature?.signer?.commonName).toBe('Asha Rao');
  });

  it('still catches a change to the signed bytes', async () => {
    const ber = Buffer.from(toIndefiniteLength(sealed));
    const at = ber.indexOf('/Type /Page');
    ber[at + 1] = 'X'.charCodeAt(0);
    const [signature] = await verifySignatures(ber);
    expect(signature?.valid).toBe(false);
  });

  it('does not accept BER for a seal, which must be DER', async () => {
    const result = await verifySeal(toIndefiniteLength(sealed));
    expect(result.valid).toBe(false);
  });
});
