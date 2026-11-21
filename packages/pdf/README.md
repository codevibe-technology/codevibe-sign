# @codevibe_technology/sign-pdf

The PDF side of Codevibe Sign. It checks uploaded files, draws signatures and field
values onto the pages, appends a signing certificate, and seals the result with a PAdES
signature so any later change is detectable. It also verifies that seal against the
certificate you trust.

Node 20 or later. Built on [pdf-lib](https://pdf-lib.js.org), `@signpdf` and
`node-forge`.

## Install

```sh
pnpm add @codevibe_technology/sign-pdf @codevibe_technology/sign-core
```

## Usage

<!-- check:
import type { AuditEvent, Document, Envelope } from '@codevibe_technology/sign-core';
declare const envelope: Envelope;
declare const document: Document;
declare const events: AuditEvent[];
-->

```ts check
import { readFile } from 'node:fs/promises';
import {
  appendCertificate,
  inspectPdf,
  renderFields,
  seal,
  sealCertificate,
  sha256Hex,
  verify,
} from '@codevibe_technology/sign-pdf';

// 1. On upload: reject encrypted, broken, oversized or overly complex files (read in a
//    worker thread under limits) and record page sizes.
const original = new Uint8Array(await readFile('offer.pdf'));
const { pageCount, pages } = await inspectPdf(original, { maxBytes: 10 * 1024 * 1024 });
const sha256 = sha256Hex(original);
// `pages` maps directly onto core's Document.pageSizes.

// 2. When the envelope completes: draw every value (on a copy stripped of scripts and
//    actions, forms flattened), add the certificate, seal.
const signed = await renderFields(original, envelope.fields, envelope.values, envelope.recipients, {
  documentId: document.id,
  timeZone: 'Asia/Kolkata',
});
const withCertificate = await appendCertificate(signed, {
  envelope,
  document,
  events, // the envelope's audit events, in order
  timeZone: 'Asia/Kolkata',
});
const p12 = new Uint8Array(await readFile(process.env.SEAL_P12_PATH!));
const passphrase = process.env.SEAL_P12_PASSPHRASE;
const sealed = await seal(withCertificate, {
  p12,
  passphrase,
  reason: 'Signed with Codevibe Sign',
  location: 'Bengaluru, India',
});

// 3. Any time later: check the file is exactly what your certificate sealed.
const operator = sealCertificate({ p12, passphrase }); // keep operator.sha256 or operator.pem
const check = await verify(sealed, { trust: { fingerprints: [operator.sha256] } });
// { valid: true, trustedBy: 'certificate', signer: { commonName, organization },
//   signedAt, certificateSha256, seal: { ... } }
```

All failures throw a `SignError` from `@codevibe_technology/sign-core` with a stable `code` and,
where it helps, `details` that name the field or option to fix.

## API

### `inspectPdf(bytes, { maxBytes?, limits? }) → Promise<{ pageCount, pages: { width, height }[] }>`

Page sizes are in PDF points as the page is displayed: the crop box, with width and height
swapped for pages rotated 90 or 270 degrees. This is the space field rects live in.
`maxBytes` defaults to 25 MB.

Use it on every upload. Before the file is parsed on your thread, a worker thread reads it
under `limits` and is terminated if it runs out of time, so one hostile file cannot block the
event loop or exhaust memory:

| Limit             | Default | Refuses                                                             |
| ----------------- | ------- | ------------------------------------------------------------------- |
| `maxPages`        | 500     | More pages than this.                                               |
| `maxObjects`      | 100 000 | More indirect objects than this.                                    |
| `maxDepth`        | 64      | Arrays and dictionaries, or the page tree, nested deeper than this. |
| `maxDecodedBytes` | 50 MB   | Compressed streams that inflate to more than this, together.        |
| `timeoutMs`       | 10 s    | Files that take longer to read; the worker is killed.               |

The worker also has a 512 MB heap; a file that needs more is refused. `checkParseLimits(bytes,
limits?)` runs the same check on its own, and `DEFAULT_PARSE_LIMITS` holds the defaults. The
worker ships inline with its own copy of pdf-lib, so it runs the same whether your app loads this
package from `node_modules` or a bundler (Next.js, webpack, esbuild) inlines it. If the worker
cannot start at all, the check throws a plain `Error`, not `DOCUMENT_INVALID`: the fault is the
host's, not the file's.

It also refuses a PDF that already carries digital signatures (signed `/Sig` fields), with
`PDF_ALREADY_SIGNED` and `details.signatureCount`. Drawing fields and sealing write the file
again, which would silently remove those signatures; ask for the unsigned original instead.
The message is `ALREADY_SIGNED_MESSAGE`, ready to show as is.

Errors: `DOCUMENT_TOO_LARGE`; `PDF_ALREADY_SIGNED`; `DOCUMENT_INVALID` with `details.reason` of
`encrypted`, `unreadable`, `empty`, `timeout` or `limit` (then `details.limit` names it, with
`details.max`).

### `sha256Hex(bytes) → string`

Lowercase hex SHA-256.

### `renderFields(pdfBytes, fields, values, recipients, options?) → Promise<Uint8Array>`

Draws each field onto its page. Rects use core's convention (points from the top-left of
the displayed page); rotated pages and offset crop boxes are handled, and content is
drawn upright as the reader sees it.

The pages are first copied into a fresh document without active content: `/OpenAction`
and `/AA` actions, JavaScript, embedded files, launch, URI and every other action except
in-document links, file attachment and media annotations, and XFA. Form fields are
flattened into the page. Outlines, the structure tree and objects the pages do not use are
left behind, and the output is a newly written file, never an incremental update. The same
step is available on its own as `sanitizePdf(bytes)`.

- `signature`, `initials`: PNG as base64 (a `data:image/png;base64,` prefix is accepted).
  Each image is re-encoded before it is embedded: the header must declare at most
  2048 × 2048 pixels, the pixel data must inflate to exactly the size the header implies,
  every chunk checksum and scanline filter must be valid, and only the header, palette,
  transparency and freshly compressed pixels are kept. Scaled to fit the box, aspect ratio
  kept, centred.
- Under each `signature` image, in small grey type at the foot of the box, the signer's
  name and signing time (`recipient.actedAt`, in `timeZone` or UTC), for example
  `Asha Rao, 19 Nov 2026 15:45 GMT+5:30`. The image shrinks to make room. Boxes under 20
  points tall get no caption; `signatureCaption: false` turns it off.
- `text`, `name`, `date_signed`: Helvetica, sized down (to 6 pt) and wrapped to fit; text
  that still does not fit is cut with an ellipsis. `name` falls back to the recipient's
  name and `date_signed` to the recipient's `actedAt`. Dates print as `19 Nov 2026`.
- `checkbox`: `'true'` or `'false'`; a box is drawn, with a tick when checked.

Boxes that run off the page are trimmed to it.

| Option          | Default | Purpose                                                       |
| --------------- | ------- | ------------------------------------------------------------- |
| `documentId`    | all     | Draw only the fields of this document.                        |
| `font`          | none    | TTF/OTF bytes for text outside Latin script.                  |
| `timeZone`      | `UTC`   | IANA zone used to turn a `date_signed` timestamp into a date. |
| `formatDate`    | none    | `(isoValue) => string` for `date_signed` text.                |
| `maxImageBytes` | 1 MB    | Largest signature image.                                      |
| `maxBytes`      | 25 MB   | Largest input PDF.                                            |

Errors: `REQUIRED_FIELDS_MISSING` (`details.fieldIds`), `INVALID_FIELD_VALUE` (bad image,
checkbox value, or characters the font cannot draw), `RECIPIENT_NOT_FOUND`, `VALIDATION`
(page out of range, box outside the page, unknown time zone).

### `appendCertificate(pdfBytes, data, options?) → Promise<Uint8Array>`

Appends one or more A4 pages titled "Signing certificate". `data` is
`{ envelope, document, events, timeZone?, generatedAt?, note? }` using core's types. The pages
show:

- envelope id, title, status and its key times;
- document name, page count, the original SHA-256 (`document.sha256`) and the SHA-256 of
  `pdfBytes`, the final signed content before the certificate and seal;
- each recipient: name, role, email or phone masked lightly (`s****@example.com`,
  `+91******3210`), authentication method, status, IP address and user agent of their
  decisive action, and when they viewed, signed or approved, or declined (with the reason);
- the audit chain head and every event with its time, action and who did it;
- `note`, when given: one line from the sender at the end, such as a company registration
  number. Characters the font cannot draw become `?`.

Times are shown in UTC, followed by the given time zone. Long values wrap; tables continue
on new pages with their header repeated.

`options`: `font` (as above) and `maxBytes`.

### `seal(pdfBytes, options) → Promise<Uint8Array>`

Applies a PAdES signature: SubFilter `ETSI.CAdES.detached`, SHA-256 with RSA, signed
attributes content-type, message-digest and signing-certificate-v2, signing time in the
signature dictionary (baseline B-B). With `tsaUrl` it also carries an RFC 3161 signature
timestamp as the unsigned attribute signature-time-stamp-token (baseline B-T). The seal
covers the whole file and, being the first signature, is a certification signature with
DocMDP permissions P=1: readers show the file as certified and flag any later change.

| Option               | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `p12`                | PKCS#12 (`.p12`/`.pfx`) bytes with an RSA key, its cert and any issuer. |
| `passphrase`         | The file's passphrase.                                                  |
| `signer`             | A `SealProvider` to sign with instead of `p12`; see below.              |
| `reason`             | Shown by PDF readers. Has a sensible default.                           |
| `location`           | Optional.                                                               |
| `contactInfo`        | Optional.                                                               |
| `signingTime`        | Defaults to now. Must fall inside the certificate validity.             |
| `maxBytes`           | Largest input PDF, 25 MB by default.                                    |
| `allowWeakKey`       | Local development only; see below.                                      |
| `tsaUrl`             | RFC 3161 timestamp authority, such as `http://timestamp.digicert.com`.  |
| `tsaRequired`        | Fail when the authority fails. Default `true` when `tsaUrl` is set.     |
| `tsaTimeoutMs`       | How long to wait for the authority, 15 seconds by default.              |
| `onTimestampFailure` | Called with the error when an optional timestamp was skipped.           |
| `certify`            | `false` makes an ordinary approval signature instead of certifying.     |

The key must be RSA of at least 2048 bits and the certificate signed with SHA-256 or
stronger, and valid (not expired, not yet to start) at the signing time. `allowWeakKey: true`
accepts shorter keys and SHA-1 certificates, for throwaway keys in local development; never
set it in production.

The seal certificate may be a single self-signed certificate, or a leaf issued by your own
private root (see `deploy/README.md`) or by a CA. A leaf issued by a CA must say `CA:FALSE`;
when key usage is present it must allow digitalSignature or nonRepudiation, and when extended
key usage is present it must include documentSigning (1.3.6.1.5.5.7.3.36), msDocumentSigning
(1.3.6.1.4.1.311.10.3.12), Adobe authentic documents, emailProtection or any. Issuing
certificates found in the `.p12` are checked (each signed the one below it, is a CA and is
valid at the signing time) and embedded in the signature, so a verifier only needs the root.

The timestamp is requested over the signature value with a fresh nonce. The answer must be
granted, carry the same nonce and SHA-256 imprint, and be signed by the authority; otherwise
sealing fails with `SEAL_FAILED` and `details.option` `tsaUrl`, unless `tsaRequired` is false.

A file that already carries signatures is refused with `PDF_ALREADY_SIGNED`: sealing writes
the whole file again and would remove them. Sealing after another signature (for example an
Aadhaar eSign) needs an incremental update and an approval signature, which this version does
not do yet.

#### Signers

`p12Signer({ p12, passphrase })` is what `seal()` uses by default. To keep the key elsewhere,
pass `signer`, any object with `certificateChain()` (DER, seal certificate first) and
`sign(data)` (SHA-256 with RSA PKCS#1 v1.5 over `data`, returning the raw signature).
`pkcs11Signer()` (HSM or token) and `cscSigner()` (Cloud Signature Consortium remote signing)
are typed placeholders in this version: each call fails with `SEAL_FAILED` and
`details.provider`.

The certificate is the operator's, not the signer's: it proves the file has not changed
since sealing. Signer intent is proven by the certificate pages and the audit trail.
Errors: `SEAL_FAILED` (bad file or passphrase, no RSA key, weak key or certificate with
`details.keyBits` or `details.signatureAlgorithm`, certificate not valid at the signing time,
a certificate profile problem with `details.reason`, a timestamp failure), `PDF_ALREADY_SIGNED`
and the `DOCUMENT_*` codes above.

### `sealCertificate({ p12, passphrase?, allowWeakKey?, at? }) → SealCertificate`

Opens the PKCS#12 file with the same checks as `seal()` and returns
`{ pem, sha256, subject, notBefore, notAfter }`. Call it at start-up to fail early, and keep
`sha256` (or `pem`) as what `verify()` should trust.

### `verify(bytes, { trust, limits? }) → Promise<VerifyResult>`

The check to use when deciding whether a file is genuine. `valid` is true only when:

1. the file has exactly one signature, found through its form's signature field;
2. that signature is cryptographically intact (see `verifySeal`);
3. it covers every byte of the file, so nothing was appended after sealing;
4. the signer certificate is one you trust: its SHA-256 is in `trust.fingerprints`, it is
   one of `trust.certificates` (PEM or DER), or it chains through the certificates in the
   signature to one of `trust.roots` and was valid at the signing time.

`trust` must name at least one certificate, fingerprint or root. The file is read under the
parser limits in a worker first, as in `inspectPdf`.

```ts
interface VerifyResult {
  valid: boolean;
  reason?:
    | 'not_sealed'
    | 'multiple_signatures'
    | 'signature_invalid'
    | 'not_whole_document'
    | 'untrusted_signer';
  signer?: { commonName?: string; organization?: string };
  signedAt?: string;
  certificateSha256?: string; // of the signer certificate
  trustedBy?: 'certificate' | 'root';
  seal: SealVerification; // the low-level result below
}
```

Keep the certificates of earlier keys in `trust` after a rotation, so files they sealed
keep verifying.

### `verifySeal(bytes) → Promise<SealVerification>`

The low-level check `verify()` builds on. It takes the first signed signature field of the
document's form (text that only looks like a signature dictionary is ignored), and checks
that its byte range is well formed and brackets the `/Contents` the field declares,
`/Contents` holds exactly the CMS structure (any change to it, even in padding, fails), the
message digest matches the signed bytes, the signing-certificate-v2 hash matches the
embedded certificate, and the RSA signature verifies.

```ts
interface SealVerification {
  sealed: boolean; // a signature is present
  valid: boolean; // it is intact and matches the bytes it covers
  coversWholeDocument: boolean; // false if anything was appended after sealing
  signer?: { commonName?: string; organization?: string };
  signedAt?: string; // ISO time
  signatureCount: number;
  timestampedAt?: string; // ISO time from a valid RFC 3161 signature timestamp
}
```

`timestampedAt` is set only when the timestamp token's imprint matches the signature and the
authority's signature on the token verifies; whether the authority is trusted is not checked.

`valid` says nothing about who sealed the file: anyone can seal an altered copy with their
own key and `verifySeal` will call it valid. It also runs without parser limits. Use
`verify()` with your operator certificate to decide whether a file is genuine.

### `maskEmail(email)`, `maskPhone(phone)`

The masking used on the certificate, for reuse in emails and screens.

## Fonts and scripts

The standard fonts cover Latin script only. Names, titles or text in other scripts
(Devanagari, Tamil, and so on) need a font that covers them, passed as `font` to
`renderFields` and `appendCertificate`, for example Noto Sans Devanagari:

<!-- check:
import { readFile } from 'node:fs/promises';
import { appendCertificate, renderFields, type CertificateData } from '@codevibe_technology/sign-pdf';
import type { Envelope } from '@codevibe_technology/sign-core';
declare const pdf: Uint8Array;
declare const signed: Uint8Array;
declare const data: CertificateData;
declare const envelope: Envelope;
const { fields, values, recipients } = envelope;
-->

```ts check
const font = new Uint8Array(await readFile('NotoSansDevanagari-Regular.ttf'));
await renderFields(pdf, fields, values, recipients, { font });
await appendCertificate(signed, data, { font });
```

Without it, those calls fail with a message pointing at `options.font` rather than
drawing the wrong glyphs. The font is embedded whole (not subset). Shaping for complex
scripts comes from fontkit; it handles conjuncts and vowel signs, but check the output
with the font you choose.

## Limits

- Sealing keys must be RSA. Encrypted PDFs are rejected rather than decrypted.
- Sealing rewrites the file; seal last, and do not seal a file that already carries
  someone else's signature.
- `verify` and `verifySeal` locate signatures through the form's signature fields and
  check PAdES B-B seals like the ones produced here. They are not a general PDF signature
  validator: no revocation checks, timestamps or long-term validation.
- Sanitising drops document-level features such as bookmarks and the tagged structure tree.

## Licence

Apache-2.0 © Codevibe
