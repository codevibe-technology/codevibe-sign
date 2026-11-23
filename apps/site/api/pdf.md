---
title: '@codevibe_technology/sign-pdf'
description: API reference for @codevibe_technology/sign-pdf - reading page sizes, drawing field values, the certificate page, PAdES sealing and verification.
---

# @codevibe_technology/sign-pdf

The PDF side of Codevibe Sign. It checks uploaded files, draws signatures and field
values onto the pages, appends a signing certificate, and seals the result with a PAdES
signature so any later change is detectable. It also verifies that seal against the
certificate you trust.

Node 22 or later. Built on [pdf-lib](https://pdf-lib.js.org), `@signpdf` and
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
limits?)` runs the same check on its own, and `DEFAULT_PARSE_LIMITS` holds the defaults.

Errors: `DOCUMENT_TOO_LARGE`; `DOCUMENT_INVALID` with `details.reason` of `encrypted`,
`unreadable`, `empty`, `timeout` or `limit` (then `details.limit` names it, with `details.max`).

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
- `text`, `name`, `date_signed`: Helvetica, sized down (to 6 pt) and wrapped to fit; text
  that still does not fit is cut with an ellipsis. `name` falls back to the recipient's
  name and `date_signed` to the recipient's `actedAt`. Dates print as `19 Nov 2026`.
- `checkbox`: `'true'` or `'false'`; a box is drawn, with a tick when checked.
- `aadhaar`: no value and nothing is drawn. The field type is kept for envelopes sent while
  it marked where an Aadhaar eSign signer signs; the eSign provider places that signature.

Boxes that run off the page are trimmed to it.

| Option          | Default | Purpose                                                       |
| --------------- | ------- | ------------------------------------------------------------- |
| `documentId`    | all     | Draw only the fields of this document.                        |
| `font`          | none    | TTF/OTF bytes tried first; see Fonts and scripts.             |
| `timeZone`      | `UTC`   | IANA zone used to turn a `date_signed` timestamp into a date. |
| `formatDate`    | none    | `(isoValue) => string` for `date_signed` text.                |
| `maxImageBytes` | 1 MB    | Largest signature image.                                      |
| `maxBytes`      | 25 MB   | Largest input PDF.                                            |

Errors: `REQUIRED_FIELDS_MISSING` (`details.fieldIds`), `INVALID_FIELD_VALUE` (bad image,
checkbox value), `RECIPIENT_NOT_FOUND`, `VALIDATION`
(page out of range, box outside the page, unknown time zone).

### `appendCertificate(pdfBytes, data, options?) → Promise<Uint8Array>`

Appends an A4 page titled "Signing certificate". `data` is
`{ envelope, document, events, timeZone?, generatedAt?, sender?, recordUrl?, note?, esign? }`
using core's types. The page shows:

- the envelope title, document name and page count, envelope id, status and when it was
  completed;
- `sender`, when given: `{ name, organization?, email? }`, the email masked;
- each recipient: name, role, email or phone masked lightly (`s****@example.com`,
  `+91******3210`), how they proved who they are, and when they signed, approved or declined
  (with the reason);
- the document fingerprint: the SHA-256 of the original file (`document.sha256`), in short
  and in full, and the head of the audit chain;
- `recordUrl`, when given: a QR code for a page that shows this signing's record, such as the
  public record page of the web app. The code is also a link in PDF readers; the address
  itself is not printed;
- under the code, "Signing certificate provided by:" and a small Codevibe Sign logo, drawn as
  vector paths so it needs no font;
- `note`, when given: one line from the sender at the end, such as a company registration
  number.

IP addresses, browser details and the list of audit events are not printed; `auditTrailPdf`
makes the event list a file of its own. Times are shown in the given time zone with UTC
under them, or in UTC alone. A usual envelope fits one page; with many recipients the table
continues on further pages with its header repeated.

`options`: `font` (as above) and `maxBytes`.

`esign: { recipientId, provider, sandbox?, signerName?, issuer?, signedAt? }` describes the
Aadhaar eSign of a completed envelope, as read from the signed file: that signer's row names
the method (`Aadhaar eSign (via Leegality)`), the time of the signature (`signedAt`, from its
timestamp or signing time) and the subject and issuer of their eSign certificate. Use it with
`certificateWithAuditTrailPdf`, since nothing can be added to the pages of the signed file.

### `certificatePdf(data, options?) → Promise<Uint8Array>`

The same certificate as a PDF of its own, without the document: for someone who should see
who signed and when, but not what was signed. `data` is one `CertificateData` or an array, to
put the certificates of several documents in one file. `options`: `font`.

### `certificateWithAuditTrailPdf(data, options?) → Promise<Uint8Array>`

The certificate (`CertificateData`) followed by the audit trail of the same envelope, in one
PDF: what the parties of a document signed with Aadhaar eSign get next to the signed file.
`options`: `font`, and `networkAddresses` to print the address of each event.

### `auditTrailPdf(data, options?) → Promise<Uint8Array>`

The audit trail as a PDF. `data` is `{ envelope, events, timeZone?, generatedAt?, recordUrl? }`.
A small Codevibe Sign logo sits at the top. Then the envelope (status, when it was sent and
completed, the head of the hash chain), each document with the SHA-256 of the original and of
the signed file, each recipient with their role, method and status, and every event with its
number, its time in `timeZone` and in UTC, what happened, who did it and, for a signature,
how it was given (`Aadhaar eSign (via Leegality)` with the name on the eSign certificate).
Browser details are left out and an email address named in an event is masked.

`options`: `font`, and `networkAddresses: true` to print the network address of each event
where one was recorded. Leave it off for a file anyone with a link can open, such as the
public record; the server turns it on for the parties' own copy.

### `seal(pdfBytes, options) → Promise<Uint8Array>`

Applies a PAdES baseline B-B signature: SubFilter `ETSI.CAdES.detached`, SHA-256 with RSA,
signed attributes content-type, message-digest and signing-certificate-v2, signing time in
the signature dictionary. The seal covers the whole file.

| Option         | Purpose                                                     |
| -------------- | ----------------------------------------------------------- |
| `p12`          | PKCS#12 (`.p12`/`.pfx`) bytes with an RSA key and its cert. |
| `passphrase`   | The file's passphrase.                                      |
| `reason`       | Shown by PDF readers. Has a sensible default.               |
| `location`     | Optional.                                                   |
| `contactInfo`  | Optional.                                                   |
| `signingTime`  | Defaults to now. Must fall inside the certificate validity. |
| `maxBytes`     | Largest input PDF, 25 MB by default.                        |
| `allowWeakKey` | Local development only; see below.                          |

The key must be RSA of at least 2048 bits and the certificate signed with SHA-256 or
stronger, and valid (not expired, not yet to start) at the signing time. `allowWeakKey: true`
accepts shorter keys and SHA-1 certificates, for throwaway keys in local development; never
set it in production.

The certificate is the operator's, not the signer's: it proves the file has not changed
since sealing. Signer intent is proven by the certificate page and the audit trail.
Errors: `SEAL_FAILED` (bad file or passphrase, no RSA key, weak key or certificate with
`details.keyBits` or `details.signatureAlgorithm`, certificate not valid at the signing time)
and the `DOCUMENT_*` codes above.

### `sealCertificate({ p12, passphrase?, allowWeakKey?, at? }) → SealCertificate`

Opens the PKCS#12 file with the same checks as `seal()` and returns
`{ pem, sha256, subject, notBefore, notAfter }`. Call it at start-up to fail early, and keep
`sha256` (or `pem`) as what `verify()` should trust.

### `createDevSeal(options?) → DevSeal`

Creates a self-signed RSA-2048 sealing certificate for development and tests and returns
`{ p12, passphrase, certificatePem, sha256, notBefore, notAfter }`. Options: `commonName`,
`organization`, `days` (default 365, at most 3650), `passphrase` (generated when omitted) and
`notBefore`. PDF readers show seals made with it as untrusted; production needs a certificate
issued by a certificate authority. Node only.

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
}
```

`valid` says nothing about who sealed the file: anyone can seal an altered copy with their
own key and `verifySeal` will call it valid. It also runs without parser limits. Use
`verify()` with your operator certificate to decide whether a file is genuine.

### `maskEmail(email)`, `maskPhone(phone)`

The masking used on the certificate, for reuse in emails and screens.

## Fonts and scripts

Names, titles and field text can be in any of these scripts without extra setup:
Devanagari (Hindi, Marathi, Nepali), Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu,
Kannada, Malayalam, Arabic (including Urdu), and Latin, Greek and Cyrillic beyond the
WinAnsi set. Text the standard fonts can encode stays in Helvetica; everything else is
drawn with the bundled Noto Sans fonts. Each run is shaped with HarfBuzz, so conjuncts
(क्ष, त्र, श्री), vowel signs and Arabic joining come out right, and only the glyphs used
are embedded: a certificate with a Hindi name grows by about 2 KB. Copying or searching
the PDF gives back the text as typed. Characters no font covers (emoji, for example)
become `?` rather than failing.

For other scripts, such as Chinese, Japanese or Korean, pass a font that covers them as
`font` to `renderFields`, `appendCertificate`, `certificatePdf` and `auditTrailPdf`. It
is tried first for every character it has. A TrueType font is shaped and subset like the
bundled ones; a CFF-based OpenType font is embedded whole and laid out by pdf-lib.

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
const font = new Uint8Array(await readFile('NotoSansSC-Regular.otf'));
await renderFields(pdf, fields, values, recipients, { font });
await appendCertificate(signed, data, { font });
```

The bundled fonts are Noto Sans, under the SIL Open Font License 1.1 (see `fonts/OFL.txt`).

## Limits

- Sealing keys must be RSA. Encrypted PDFs are rejected rather than decrypted.
- Sealing rewrites the file; seal last, and do not seal a file that already carries
  someone else's signature.
- `verify` and `verifySeal` locate signatures through the form's signature fields and
  check PAdES B-B seals like the ones produced here. They are not a general PDF signature
  validator: no revocation checks, timestamps or long-term validation.
- Sanitising drops document-level features such as bookmarks and the tagged structure tree.
