import { beforeAll, describe, expect, it } from 'vitest';
import { seal } from './seal';
import { A4, makePdf } from './testing/fixtures';
import { createTestP12, type TestP12 } from './testing/p12';
import { verifySeal, verifySignatures } from './verify';

/**
 * Rewrites the outer SEQUENCE of the only signature in `pdf` from a definite length to BER's
 * indefinite length with end-of-contents markers, as Leegality's Aadhaar eSign writes it.
 * The header shrinks by as many bytes as the markers add, so the padded /Contents keeps its size.
 */
function toIndefiniteLength(pdf: Uint8Array): Uint8Array {
  const text = Buffer.from(pdf).toString('latin1');
  const match = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(text);
  if (!match?.[1]) throw new Error('no /Contents');
  const hex = match[1];
  const bytes = Buffer.from(hex, 'hex');
  expect(bytes[0]).toBe(0x30);
  const octets = (bytes[1] ?? 0) & 0x7f;
  let length = 0;
  for (let i = 0; i < octets; i += 1) length = length * 256 + (bytes[2 + i] ?? 0);
  const body = bytes.subarray(2 + octets, 2 + octets + length);
  const ber = Buffer.concat([Buffer.from([0x30, 0x80]), body, Buffer.from([0, 0])]);
  const padded = Buffer.alloc(bytes.length);
  ber.copy(padded);
  const out = text.replace(hex, padded.toString('hex'));
  return Buffer.from(out, 'latin1');
}

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
