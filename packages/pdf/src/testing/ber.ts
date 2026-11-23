/**
 * Rewrites the outer SEQUENCE of the only signature in `pdf` from a definite length to BER's
 * indefinite length with end-of-contents markers, as Leegality's Aadhaar eSign writes it.
 * The header shrinks by as many bytes as the markers add, so the padded /Contents keeps its size.
 */
export function toIndefiniteLength(pdf: Uint8Array): Uint8Array {
  const text = Buffer.from(pdf).toString('latin1');
  const match = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(text);
  if (!match?.[1]) throw new Error('no /Contents');
  const hex = match[1];
  const bytes = Buffer.from(hex, 'hex');
  if (bytes[0] !== 0x30) throw new Error('the signature is not a SEQUENCE');
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
