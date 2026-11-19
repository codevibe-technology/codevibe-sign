# codevibe-sign

Open-source e-signatures for your own product. Send PDFs for signature, collect signatures in
the order you choose, and get back one sealed file with a certificate page and an audit trail
anyone can verify offline. Your documents stay on your servers.

This is the one package to install: the signing server, the typed client, the PDF tools, the
React components and a `codevibe-sign` command line, with subpath imports so each bundle only
carries what it uses.

<p>
  <a href="https://sign.codevibe.in?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=nav">Docs</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#command-line">Command line</a> ·
  <a href="#use-it-from-code">From code</a> ·
  <a href="#packages">Packages</a> ·
  <a href="#licence">Licence</a>
</p>

> Pre-release: APIs may change before 0.1.

## Quick start

Start a server with nothing to set up. Everything lives in memory, the seal certificate is
generated, and emails and one-time codes are printed to the terminal:

```sh
npx codevibe-sign start --memory
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

The invitation, with Asha's signing link, appears in the server's output. Once she signs, the
sealed PDF is at `GET /v1/envelopes/:id/documents/:docId`, and you can check it yourself:

```sh
npx codevibe-sign verify signed.pdf
```

Needs Node.js 20 or newer. For the real service (PostgreSQL, SMTP, your own certificate), see
[Self-host](https://sign.codevibe.in/getting-started/docker?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body).

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

  start     Run the signing server (add --memory to try it with no setup)
  verify    Check that a sealed PDF is unchanged and sealed by who you expect
  inspect   Pages, page sizes, encryption and seal of a PDF
  keygen    Create a self-signed sealing certificate for development
  hash      SHA-256 of a file, as printed on the certificate page
  api-key   Generate a random API key for API_KEYS
```

Every command takes `--help`; `codevibe-sign --version` prints the version. Commands that
report on a file take `--json`. Exit codes: `0` success, `1` the check failed (invalid seal,
unusable PDF), `2` invalid usage or a file that could not be read.

### start

```sh
npx codevibe-sign start --memory                       # try it, nothing saved
codevibe-sign start                                    # the real service, from environment variables
codevibe-sign start --seal seal.p12 --public-url https://sign.example.com
```

Without `--memory` it runs the same service as the Docker image from the same variables:
`DATABASE_URL`, `PUBLIC_URL`, `API_KEYS`, `SEAL_P12_BASE64`, `SEAL_P12_PASSPHRASE`,
`SMTP_HOST`, `SMTP_FROM` and the optional ones in the
[variable reference](https://sign.codevibe.in/getting-started/docker?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body).
`--port`, `--host`, `--public-url`, `--database-url`, `--files-dir` and `--seal <file.p12>`
override their variable. Passwords and keys are read from the environment only. Every missing
or invalid variable is reported at once, by name. `Ctrl+C` lets running work finish before it
exits.

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

Run the server inside your own Node app:

<!-- check: declare const p12: Uint8Array; -->

```ts check
import { startSignServer } from 'codevibe-sign/server';

const sign = await startSignServer({
  databaseUrl: process.env.DATABASE_URL!,
  filesDir: './data/files',
  smtp: { host: 'smtp.example.com', port: 587, secure: false, from: 'Sign <sign@example.com>' },
  seal: { p12, passphrase: process.env.SEAL_P12_PASSPHRASE! },
  apiKeys: [process.env.SIGN_API_KEY!],
  publicUrl: 'https://sign.example.com',
});
await sign.listen(3000);
```

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

| Import                 | What you get                                                                                    | Runs in                 |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| `codevibe-sign`        | The most used parts of all of the below, plus `createDevSeal()` for tests.                      | Node                    |
| `codevibe-sign/server` | `createSignServer`, `startSignServer`, `configFromEnv` and the storage, file and mail adapters. | Node                    |
| `codevibe-sign/client` | `createSignClient`, `createSignerClient`, `verifyWebhook`, `readWebhook`. No dependencies.      | Node, browsers, edge    |
| `codevibe-sign/pdf`    | `verify`, `verifySeal`, `seal`, `inspectPdf`, `sealCertificate` and the drawing helpers.        | Node                    |
| `codevibe-sign/core`   | Types, the signing rules and `verifyChain` for the audit log. No I/O.                           | anywhere                |
| `codevibe-sign/react`  | `SigningView`, `SignaturePad`, `FieldPlacer`; styles in `codevibe-sign/react/styles.css`.       | browsers, needs `react` |

## Packages

`codevibe-sign` re-exports these scoped packages. Install one directly if you only need that
part.

| Package                                                                                              | What it does                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`@codevibe_technology/sign-server`](https://www.npmjs.com/package/@codevibe_technology/sign-server) | HTTP API and runtime with adapters for storage, files, mail and OTP. |
| [`@codevibe_technology/sign-client`](https://www.npmjs.com/package/@codevibe_technology/sign-client) | Typed client for the HTTP API, signing sessions and webhooks.        |
| [`@codevibe_technology/sign-pdf`](https://www.npmjs.com/package/@codevibe_technology/sign-pdf)       | Draws fields, appends the certificate page, seals and verifies PDFs. |
| [`@codevibe_technology/sign-core`](https://www.npmjs.com/package/@codevibe_technology/sign-core)     | Envelopes, routing, reminders, expiry and the audit chain. No I/O.   |
| [`@codevibe_technology/sign-react`](https://www.npmjs.com/package/@codevibe_technology/sign-react)   | Signature pad, signing view and field placement components.          |

Aadhaar eSign and templates are separate:
[`@codevibe_technology/sign-aadhaar`](https://www.npmjs.com/package/@codevibe_technology/sign-aadhaar)
and
[`@codevibe_technology/sign-templates`](https://www.npmjs.com/package/@codevibe_technology/sign-templates).

## Learn more

- [Documentation](https://sign.codevibe.in?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body)
- [Send your first envelope](https://sign.codevibe.in/guides/first-envelope?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body)
- [Verify a sealed PDF](https://sign.codevibe.in/guides/verify-pdf?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body)
- [Legal note](https://sign.codevibe.in/legal?utm_source=github&utm_medium=readme&utm_campaign=codevibe-sign&utm_content=body):
  what an electronic signature covers under the IT Act, and when you need Aadhaar eSign.
- [Source and issues](https://github.com/codevibe-technology/codevibe-sign)

## Licence

This package is Apache-2.0 © Codevibe. The server it re-exports (`codevibe-sign/server` and
`codevibe-sign start`) comes from `@codevibe_technology/sign-server` under AGPL-3.0-only, which
is free to use and self-host, including inside your company; you only have to share changes
if you offer a modified server to others over a network. See
[LICENSING.md](https://github.com/codevibe-technology/codevibe-sign/blob/main/LICENSING.md).
