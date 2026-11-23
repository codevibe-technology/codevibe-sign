import { X509Certificate } from 'node:crypto';
import { SignError } from '@codevibe_technology/sign-core';
import {
  verify as verifyPdf,
  type SealSigner,
  type VerifyFailure,
  type VerifyResult,
  type VerifyTrust,
} from '@codevibe_technology/sign-pdf';
import { formatTime, isPdf, signerName } from './format';
import { EXIT, painter, parse, readInput, rows, UsageError, type Command } from './io';

/**
 * Trusting a fingerprint no certificate has runs every check except trust, so a file checked
 * without `--trust` still reports its signer fingerprint and fails only as `untrusted_signer`.
 */
const NOBODY = '0'.repeat(64);

const REASONS: Record<VerifyFailure, string> = {
  not_sealed: 'the file has no seal.',
  signature_invalid: 'the seal does not match the file, so it was changed after sealing.',
  not_whole_document:
    'something was added after the seal. The sealed part is intact, the rest is not covered.',
  multiple_signatures: 'the file has more than one signature; a sealed file has exactly one.',
  earlier_signature_invalid: 'a signature made before the seal does not match the file any more.',
  untrusted_signer: 'the seal is intact, but it was not made with a certificate you trust.',
};

export interface VerifyReport {
  file: string;
  valid: boolean;
  /** Whether the signer certificate was checked against `--trust`, `--fingerprint` or `--root`. */
  signerChecked: boolean;
  reason?: VerifyFailure;
  message: string;
  signer?: SealSigner;
  signedAt?: string;
  coversWholeDocument: boolean;
  signatureCount: number;
  certificateSha256?: string;
  trustedBy?: 'certificate' | 'root';
}

async function certificates(files: string[] | undefined): Promise<Uint8Array[]> {
  return Promise.all(
    (files ?? []).map(async (file) => {
      const bytes = await readInput(file);
      try {
        return new Uint8Array(new X509Certificate(bytes).raw);
      } catch {
        throw new UsageError(`${file}: not a certificate (PEM or DER)`);
      }
    }),
  );
}

function report(file: string, result: VerifyResult, signerChecked: boolean): VerifyReport {
  const intactButUnchecked = !signerChecked && result.reason === 'untrusted_signer';
  const valid = result.valid || intactButUnchecked;
  const message = result.valid
    ? 'sealed with a trusted certificate and unchanged since.'
    : intactButUnchecked
      ? 'the seal matches the file. Who sealed it was not checked.'
      : REASONS[result.reason ?? 'signature_invalid'];
  return {
    file,
    valid,
    signerChecked,
    ...(valid ? {} : { reason: result.reason ?? 'signature_invalid' }),
    message,
    ...(result.signer ? { signer: result.signer } : {}),
    ...(result.signedAt ? { signedAt: result.signedAt } : {}),
    coversWholeDocument: result.seal.coversWholeDocument,
    signatureCount: result.seal.signatureCount,
    ...(result.certificateSha256 ? { certificateSha256: result.certificateSha256 } : {}),
    ...(result.trustedBy ? { trustedBy: result.trustedBy } : {}),
  };
}

export const verify: Command = {
  name: 'verify',
  summary: 'Check that a sealed PDF is unchanged and sealed by who you expect',
  help: `Usage
  codevibe-sign verify <file.pdf> [options]

Checks the PAdES seal on a file produced by Codevibe Sign: one signature, intact, covering
every byte. With --trust, --fingerprint or --root it also checks who sealed it; without them
it reports the signer's fingerprint so you can pin it next time.

Options
  --trust <cert.pem>       Trust this operator certificate (PEM or DER). Repeatable
  --fingerprint <sha256>   Trust the certificate with this SHA-256 fingerprint. Repeatable
  --root <ca.pem>          Trust certificates issued by this root CA. Repeatable
  --json                   Print the result as JSON
  -h, --help               Show this help

Exit codes
  0  valid (or intact, when no trust was given)
  1  invalid: not sealed, changed, extra content, several signatures or untrusted signer
  2  invalid usage, or the file could not be read

Examples
  codevibe-sign verify signed.pdf --trust seal.pem
  codevibe-sign verify signed.pdf --fingerprint 3f9a...c1 --json`,

  async run(args, io) {
    const { values, positionals } = parse(args, {
      trust: { type: 'string', multiple: true },
      fingerprint: { type: 'string', multiple: true },
      root: { type: 'string', multiple: true },
      json: { type: 'boolean' },
    });
    const file = positionals[0];
    if (!file) throw new UsageError('Missing file. Usage: codevibe-sign verify <file.pdf>');
    if (positionals.length > 1) throw new UsageError('Pass one file at a time.');

    const bytes = await readInput(file);
    if (!isPdf(bytes)) throw new UsageError(`${file}: not a PDF file`);

    const fingerprints = values.fingerprint ?? [];
    for (const fingerprint of fingerprints) {
      if (!/^[0-9a-f]{64}$/i.test(fingerprint.replace(/[:\s]/g, ''))) {
        throw new UsageError('--fingerprint must be 64 hex characters (colons allowed).');
      }
    }
    const certs = await certificates(values.trust);
    const roots = await certificates(values.root);
    const signerChecked = certs.length + fingerprints.length + roots.length > 0;
    const trust: VerifyTrust = {
      certificates: certs,
      fingerprints: signerChecked ? fingerprints : [NOBODY],
      roots,
    };

    let result: VerifyResult;
    try {
      result = await verifyPdf(bytes, { trust });
    } catch (error) {
      if (error instanceof SignError && error.code === 'VALIDATION') {
        throw new UsageError(error.message);
      }
      throw error;
    }
    const r = report(file, result, signerChecked);

    if (values.json) {
      io.out(JSON.stringify(r, null, 2));
      return r.valid ? EXIT.ok : EXIT.failed;
    }

    const paint = painter(io.color);
    const verdict = !r.valid
      ? paint('red', 'Invalid')
      : r.signerChecked
        ? paint('green', 'Valid')
        : paint('yellow', 'Intact');
    const details: [string, string][] = [['File', file]];
    if (r.signer) details.push(['Signer', signerName(r.signer)]);
    if (r.signedAt) details.push(['Signed', formatTime(r.signedAt)]);
    if (r.signatureCount > 0) {
      details.push([
        'Whole file',
        r.coversWholeDocument ? 'yes, nothing was added after sealing' : 'no',
      ]);
      details.push(['Signatures', String(r.signatureCount)]);
    }
    if (r.certificateSha256) details.push(['Certificate', `sha256 ${r.certificateSha256}`]);
    if (r.trustedBy) {
      details.push([
        'Trusted by',
        r.trustedBy === 'root' ? 'a root you passed' : 'a pinned certificate',
      ]);
    }
    io.out(`${verdict}: ${r.message}\n\n${rows(details)}`);
    if (!r.signerChecked && r.valid) {
      io.out(
        `\nCompare the certificate fingerprint with your operator's, or check it for you:\n` +
          `  codevibe-sign verify ${file} --trust operator.pem`,
      );
    }
    return r.valid ? EXIT.ok : EXIT.failed;
  },
};
