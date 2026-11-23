import { AppError } from '@/server/errors';
import { installSealCertificate } from '@/server/pdf';

export const dynamic = 'force-dynamic';

/**
 * The public half of this install's seal certificate, as a .crt file to check a seal against
 * or add to a PDF reader. The private key never leaves the PKCS#12 file.
 */
export function GET() {
  try {
    const { pem } = installSealCertificate();
    return new Response(pem, {
      headers: {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': 'attachment; filename="codevibe-sign-seal.crt"',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    const message =
      err instanceof AppError ? err.message : 'The seal certificate could not be read.';
    return new Response(message, { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}
