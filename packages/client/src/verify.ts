import { path, Transport, type RequestOptions, type TransportOptions } from './http';
import { bytesOf } from './multipart';
import type { PdfContent, PublicVerification } from './types';

export interface VerifyClient {
  /**
   * Uploads a PDF and says whether it is exactly a document the server sealed. The answer is
   * a result either way; only a file that cannot be a PDF at all is refused with an error.
   */
  pdf(content: PdfContent, options?: RequestOptions): Promise<PublicVerification>;
  /** The same answer for the SHA-256 (hex) of a sealed PDF, without uploading it. */
  sha256(hash: string, options?: RequestOptions): Promise<PublicVerification>;
}

export function verifyCalls(http: Transport): VerifyClient {
  return {
    async pdf(content, options) {
      return http.json({
        method: 'POST',
        path: '/v1/verify',
        body: { bytes: await bytesOf(content), contentType: 'application/pdf' },
        options,
      });
    },
    sha256: (hash, options) =>
      http.json({ method: 'GET', path: path`/v1/verify/${hash}`, options }),
  };
}

/**
 * Checks sealed PDFs against a server without any credential: the verify routes are public.
 * Safe to use in a browser when the server allows your origin.
 */
export function createVerifyClient(options: TransportOptions): VerifyClient {
  return verifyCalls(new Transport(options));
}
