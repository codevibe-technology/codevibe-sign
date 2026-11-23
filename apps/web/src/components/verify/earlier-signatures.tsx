import { formatDateTime } from '@/lib/envelopes';

export interface EarlierSignatureRow {
  valid: boolean;
  signer: string | null;
  issuer: string | null;
  signedAt: string | null;
}

/**
 * Rows for a definition list: each signature the file carried before it was sealed, such as
 * an Aadhaar eSign, with who made it and which authority issued their certificate.
 */
export function EarlierSignatures({ signatures }: { signatures: EarlierSignatureRow[] }) {
  return (
    <>
      {signatures.map((signature, index) => (
        <div key={index} className="contents" data-testid="earlier-signature">
          <dt className="text-muted">Signed before the seal</dt>
          <dd className="min-w-0 break-words">
            {signature.signer ?? 'Signer not named'}
            <span className="text-muted">
              {signature.issuer ? ` · certificate from ${signature.issuer}` : ''}
              {signature.signedAt ? ` · ${formatDateTime(signature.signedAt)}` : ''}
              {signature.valid ? ' · intact' : ''}
            </span>
            {signature.valid ? null : <span className="font-semibold text-danger"> · broken</span>}
          </dd>
        </div>
      ))}
    </>
  );
}
