# codevibe-sign

Open-source e-signatures for your own product, under Apache-2.0. Seal PDFs with a PAdES
signature, verify sealed files offline, send documents for signature through a Codevibe Sign
server and put the signing page in your own React app.

This is the one library package to install: the typed API client, the PDF tools, the core
rules, the React components and a `codevibe-sign` command line, with subpath imports so each
bundle only carries what it uses. Everything in it is Apache-2.0, so it fits any product, open
or closed. The signing server is a separate package under AGPL-3.0,
[`@codevibe_technology/sign-server`](https://www.npmjs.com/package/@codevibe_technology/sign-server);
this package does not contain it or depend on it.

<p>
  <a href="https://sign.codevibe.in?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=nav">Docs</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#command-line">Command line</a> ·
  <a href="#use-it-from-code">From code</a> ·
  <a href="#packages">Packages</a> ·
  <a href="#licence">Licence</a>
</p>

> Pre-release: APIs may change before 1.0.

## Quick start

Check a sealed PDF, with nothing to set up:

```sh
npx codevibe-sign verify signed.pdf
```

To send a document for signature you need a Codevibe Sign server. Use the hosted one at
[sign.codevibe.in](https://sign.codevibe.in?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body), or run your own. The server is its own
package (AGPL-3.0); this starts it with everything in memory, a generated seal certificate, and
emails and one-time codes printed to the terminal:

```sh
npx @codevibe_technology/sign-server start --memory
```

It prints an API key and the address. Send a PDF for signature with that key:

```sh
curl -s http://localhost:3000/v1/envelopes \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Offer letter",
    "send": true,
    "documents": [{ "key": "doc", "name": "offer.pdf", "content": "'"$(base64 < offer.pdf | tr -d '\n')"'" }],
    "recipients": [{ "key": "asha", "name": "Asha Rao", "email": "asha@example.com" }],
    "fields": [{ "recipient": "asha", "type": "signature", "page": 0, "x": 72, "y": 640, "width": 180, "height": 48 }]
  }'
```

The invitation, with Asha's signing link, appears in the server's output, followed by the
one-time code she is asked for. Once she signs, the sealed PDF is at
`GET /v1/envelopes/:id/documents/:docId`, and `codevibe-sign verify` checks it.

Needs Node.js 22 or newer. For the real service (PostgreSQL, SMTP, your own certificate), see
[Self-host](https://sign.codevibe.in/docs/getting-started/docker?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body).

## Install

```sh
npm install codevibe-sign
```

React is an optional peer. Install it only if you use `codevibe-sign/react`:

```sh
npm install codevibe-sign react react-dom
```

## Command line

```text
codevibe-sign <command> [options]

  verify    Check that a sealed PDF is unchanged and sealed by who you expect
  inspect   Pages, page sizes, encryption and seal of a PDF
  keygen    Create a self-signed sealing certificate for development
  hash      SHA-256 of a file, as printed on the certificate page
  api-key   Generate a random API key for API_KEYS
```

Every command takes `--help`; `codevibe-sign --version` prints the version. Commands that
report on a file take `--json`. Exit codes: `0` success, `1` the check failed (invalid seal,
unusable PDF), `2` invalid usage or a file that could not be read.

The commands work on files on your machine and never start a server. To run one, use
`npx @codevibe_technology/sign-server start` or the Docker image.

### verify

```sh
codevibe-sign verify signed.pdf --trust operator.pem
codevibe-sign verify signed.pdf --fingerprint 3f9a...c1 --json
```

Checks the seal: exactly one signature, intact, covering every byte, and (with `--trust`,
`--fingerprint` or `--root`) made with a certificate you trust. It prints the signer, the
signing time and the certificate fingerprint, and says what failed when the file is not
valid: no seal, changed after sealing, content added after the seal, several signatures or an
untrusted signer.

### inspect

```sh
codevibe-sign inspect offer-letter.pdf
```

Reads a PDF the way the server does before it accepts an upload: page count and each page's
size in PDF points (the units field boxes use), whether it is password protected or damaged,
and whether it carries a seal.

### keygen

```sh
codevibe-sign keygen --out seal.p12 --cn "Acme HR" --cert seal.pem
```

Creates an RSA-2048 key and a self-signed certificate in a PKCS#12 file the server accepts.
For development only: PDF readers show seals made with it as untrusted, so production needs a
certificate issued by a certificate authority. The passphrase comes from `SEAL_P12_PASSPHRASE`
or is generated and printed.

### hash and api-key

`codevibe-sign hash file.pdf` prints the SHA-256 to compare with the certificate page.
`codevibe-sign api-key` prints a random key to add to `API_KEYS`.

## Use it from code

Send envelopes from your backend:

<!-- check: declare const offer: Uint8Array; -->

```ts check
import { createSignClient } from 'codevibe-sign/client';

const sign = createSignClient({
  baseUrl: 'https://sign.example.com',
  apiKey: process.env.SIGN_API_KEY!,
});
const envelope = await sign.envelopes.create({
  title: 'Offer letter',
  send: true,
  documents: [{ key: 'offer', name: 'offer.pdf', content: offer }],
  recipients: [{ key: 'asha', name: 'Asha Rao', email: 'asha@example.com' }],
  fields: [
    { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 640, width: 180, height: 48 },
  ],
});
```

Verify a sealed file anywhere, without the server:

<!-- check: declare const pdf: Uint8Array; declare const operatorPem: string; -->

```ts check
import { verify } from 'codevibe-sign/pdf';

const result = await verify(pdf, { trust: { certificates: [operatorPem] } });
if (!result.valid) console.log(`Not valid: ${result.reason}`);
```

| Import                 | What you get                                                                                              | Runs in                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------- |
| `codevibe-sign`        | The most used parts of all of the below.                                                                  | Node                    |
| `codevibe-sign/client` | `createSignClient`, `createSignerClient`, `verifyWebhook`, `readWebhook`. No dependencies.                | Node, browsers, edge    |
| `codevibe-sign/pdf`    | `verify`, `verifySeal`, `seal`, `inspectPdf`, `sealCertificate`, `createDevSeal` and the drawing helpers. | Node                    |
| `codevibe-sign/core`   | Types, the signing rules and `verifyChain` for the audit log. No I/O.                                     | anywhere                |
| `codevibe-sign/react`  | `SigningView`, `SignaturePad`, `FieldPlacer`; styles in `codevibe-sign/react/styles.css`.                 | browsers, needs `react` |

## Packages

`codevibe-sign` re-exports these scoped packages, all Apache-2.0. Install one directly if you
only need that part.

| Package                                                                                              | What it does                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`@codevibe_technology/sign-client`](https://www.npmjs.com/package/@codevibe_technology/sign-client) | Typed client for the HTTP API, signing sessions and webhooks.        |
| [`@codevibe_technology/sign-pdf`](https://www.npmjs.com/package/@codevibe_technology/sign-pdf)       | Draws fields, appends the certificate page, seals and verifies PDFs. |
| [`@codevibe_technology/sign-core`](https://www.npmjs.com/package/@codevibe_technology/sign-core)     | Envelopes, routing, reminders, expiry and the audit chain. No I/O.   |
| [`@codevibe_technology/sign-react`](https://www.npmjs.com/package/@codevibe_technology/sign-react)   | Signature pad, signing view and field placement components.          |

Aadhaar eSign and templates are separate Apache-2.0 packages:
[`@codevibe_technology/sign-aadhaar`](https://www.npmjs.com/package/@codevibe_technology/sign-aadhaar)
and
[`@codevibe_technology/sign-templates`](https://www.npmjs.com/package/@codevibe_technology/sign-templates).

The server is not part of this package.
[`@codevibe_technology/sign-server`](https://www.npmjs.com/package/@codevibe_technology/sign-server)
is licensed under AGPL-3.0-only and is installed on its own, or run from the Docker image.

## Learn more

- [Documentation](https://sign.codevibe.in?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body)
- [Send your first envelope](https://sign.codevibe.in/docs/guides/first-envelope?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body)
- [Verify a sealed PDF](https://sign.codevibe.in/docs/guides/verify-pdf?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body)
- [Legal note](https://sign.codevibe.in/docs/legal?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body):
  what an electronic signature covers under the IT Act, and when you need Aadhaar eSign.
- [Source and issues](https://github.com/codevibe-technology/codevibe-sign)

## Licence

Apache-2.0 © Codevibe. Everything `npm i codevibe-sign` installs from Codevibe is Apache-2.0:
this package and the `sign-client`, `sign-pdf` and `sign-core` packages it depends on, with
`sign-react` bundled in. None of it is AGPL code. The signing server and the web app are
separate and licensed under AGPL-3.0-only; see
[LICENSING.md](https://github.com/codevibe-technology/codevibe-sign/blob/main/LICENSING.md).
