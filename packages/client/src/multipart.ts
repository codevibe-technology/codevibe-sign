import { concat, encoder, toHex } from './bytes';
import type { PdfContent } from './types';

export interface EncodedBody {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Encodes a JSON field and files as multipart/form-data. The boundary comes from a hash of
 * the content, so the same input always gives the same bytes: the server fingerprints the
 * body to match an `Idempotency-Key`, and `FormData` would pick a random boundary each time.
 */
export async function encodeMultipart(
  field: { name: string; json: string },
  files: { name: string; content: PdfContent }[],
): Promise<EncodedBody> {
  const json = encoder.encode(field.json);
  const contents = await Promise.all(files.map((f) => bytesOf(f.content)));
  const digest = await crypto.subtle.digest('SHA-256', concat(json, ...contents));
  const boundary = `cvsign-${toHex(new Uint8Array(digest))}`;

  const parts: Uint8Array[] = [
    encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n`),
    json,
  ];
  contents.forEach((content, i) => {
    parts.push(
      encoder.encode(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="${files[i]!.name}"; ` +
          `filename="${i}.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      content,
    );
  });
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
  return { bytes: concat(...parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function bytesOf(content: PdfContent): Promise<Uint8Array> {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new Uint8Array(await content.arrayBuffer());
}
