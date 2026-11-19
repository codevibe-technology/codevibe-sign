---
title: '@codevibe/sign-pdf'
description: API reference for @codevibe/sign-pdf - reading page sizes, drawing field values, the certificate page, PAdES sealing and verification.
---

# @codevibe/sign-pdf

The PDF side of Codevibe Sign. It checks uploaded files, draws signatures and field
values onto the pages, appends a signing certificate, and seals the result with a PAdES
signature so any later change is detectable. It also verifies that seal.

Node 20 or later. Built on [pdf-lib](https://pdf-lib.js.org), `@signpdf` and
`node-forge`.

## Install

```sh
pnpm add @codevibe/sign-pdf @codevibe/sign-core
```

## Usage

<!-- check:
import type { AuditEvent, Document, Envelope } from '@codevibe/sign-core';
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
  sha256Hex,
  verifySeal,
} from '@codevibe/sign-pdf';

// 1. On upload: reject encrypted, broken or oversized files and record page sizes.
const original = new Uint8Array(await readFile('offer.pdf'));
const { pageCount, pages } = await inspectPdf(original, { maxBytes: 10 * 1024 * 1024 });
const sha256 = sha256Hex(original);
// `pages` maps directly onto core's Document.pageSizes.

// 2. When the envelope completes: draw every value, add the certificate, seal.
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
const sealed = await seal(withCertificate, {
  p12: new Uint8Array(await readFile(process.env.SEAL_P12_PATH!)),
  passphrase: process.env.SEAL_P12_PASSPHRASE,
  reason: 'Signed with Codevibe Sign',
  location: 'Bengaluru, India',
});

// 3. Any time later: check the file has not changed.
const check = await verifySeal(sealed);
// { sealed: true, valid: true, coversWholeDocument: true,
//   signer: { commonName, organization }, signedAt, signatureCount: 1 }
```

All failures throw a `SignError` from `@codevibe/sign-core` with a stable `code` and,
where it helps, `details` that name the field or option to fix.

## API

### `inspectPdf(bytes, { maxBytes? }) → Promise<{ pageCount, pages: { width, height }[] }>`

Page sizes are in PDF points as the page is displayed: the crop box, with width and height
swapped for pages rotated 90 or 270 degrees. This is the space field rects live in.
`maxBytes` defaults to 25 MB.

Errors: `DOCUMENT_TOO_LARGE`; `DOCUMENT_INVALID` with `details.reason` of `encrypted`,
`unreadable` or `empty`.

### `sha256Hex(bytes) → string`

Lowercase hex SHA-256.

### `renderFields(pdfBytes, fields, values, recipients, options?) → Promise<Uint8Array>`

Draws each field onto its page. Rects use core's convention (points from the top-left of
the displayed page); rotated pages and offset crop boxes are handled, and content is
drawn upright as the reader sees it. Nothing else in the file is changed or flattened.

- `signature`, `initials`: PNG as base64 (a `data:image/png;base64,` prefix is accepted).
  Scaled to fit the box, aspect ratio kept, centred.
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
`{ envelope, document, events, timeZone?, generatedAt? }` using core's types. The pages
show:

- envelope id, title, status and its key times;
- document name, page count, the original SHA-256 (`document.sha256`) and the SHA-256 of
  `pdfBytes`, the final signed content before the certificate and seal;
- each recipient: name, role, email or phone masked lightly (`s****@example.com`,
  `+91******3210`), authentication method, status, IP address and user agent of their
  decisive action, and when they viewed, signed or approved, or declined (with the reason);
- the audit chain head and every event with its time, action and who did it.

Times are shown in UTC, followed by the given time zone. Long values wrap; tables continue
on new pages with their header repeated.

`options`: `font` (as above) and `maxBytes`.

### `seal(pdfBytes, options) → Promise<Uint8Array>`

Applies a PAdES baseline B-B signature: SubFilter `ETSI.CAdES.detached`, SHA-256 with RSA,
signed attributes content-type, message-digest and signing-certificate-v2, signing time in
the signature dictionary. The seal covers the whole file.

| Option        | Purpose                                                     |
| ------------- | ----------------------------------------------------------- |
| `p12`         | PKCS#12 (`.p12`/`.pfx`) bytes with an RSA key and its cert. |
| `passphrase`  | The file's passphrase.                                      |
| `reason`      | Shown by PDF readers. Has a sensible default.               |
| `location`    | Optional.                                                   |
| `contactInfo` | Optional.                                                   |
| `signingTime` | Defaults to now. Must fall inside the certificate validity. |
| `maxBytes`    | Largest input PDF, 25 MB by default.                        |

The certificate is the operator's, not the signer's: it proves the file has not changed
since sealing. Signer intent is proven by the certificate pages and the audit trail.
Errors: `SEAL_FAILED` (bad file or passphrase, no RSA key, certificate not valid at the
signing time) and the `DOCUMENT_*` codes above.

### `verifySeal(bytes) → Promise<SealVerification>`

Checks the first signature in the file: the byte range is well formed, `/Contents` holds
exactly the CMS structure (any change to it, even in padding, fails), the message digest
matches the signed bytes, the signing-certificate-v2 hash matches the embedded
certificate, and the RSA signature verifies.

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

`valid` says nothing about trust in the certificate; compare `signer` with your own
operator certificate. Treat `valid && coversWholeDocument` as "unchanged since sealing".

### `maskEmail(email)`, `maskPhone(phone)`

The masking used on the certificate, for reuse in emails and screens.

## Fonts and scripts

The standard fonts cover Latin script only. Names, titles or text in other scripts
(Devanagari, Tamil, and so on) need a font that covers them, passed as `font` to
`renderFields` and `appendCertificate`, for example Noto Sans Devanagari:

<!-- check:
import { readFile } from 'node:fs/promises';
import { appendCertificate, renderFields, type CertificateData } from '@codevibe/sign-pdf';
import type { Envelope } from '@codevibe/sign-core';
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
- `verifySeal` finds signature dictionaries by scanning the file, which works for files
  produced here and most others, but is not a general PDF signature validator.
