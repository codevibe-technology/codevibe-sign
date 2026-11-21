---
title: Verify a sealed PDF
description: Check that a sealed PDF has not changed and that its audit chain is intact, in Adobe Reader or in code.
---

# Verify a sealed PDF

A sealed file can be checked by anyone who has it, without contacting the server that made it.

## In Adobe Reader

Open the file and the signature panel. Reader shows whether the document has been modified
since it was sealed. If the operator's certificate comes from a trusted issuer, Reader also
shows who sealed it; with a self-signed certificate it shows the identity as unknown, while
still detecting changes. To make Reader trust the sign.codevibe.in seal, import its
certificate: see [Trust the Codevibe Sign seal in Adobe](./trust-seal-adobe).

## On the verify page

Anyone can drop a sealed PDF on the public page at `/verify` of the install that sealed it,
[sign.codevibe.in/verify](https://sign.codevibe.in/verify) for the cloud. No account is needed.
It shows whether the seal is intact and was made by that install, the signers and their times,
and whether the audit chain still matches. The file is checked in memory on the server and not
stored. The page also shows the seal certificate's fingerprint and serves the certificate at
`/verify/certificate`.

To produce a sealed PDF as evidence in an Indian court, see
[Electronic evidence (section 63 BSA)](./section-63-certificate).

## In code

`verify` from `@codevibe_technology/sign-pdf` checks the seal offline, against the operator certificate
you trust. Keep that certificate (or its SHA-256) wherever you verify files. It is public, so
you can ship it with your app or publish it.

```ts check
import { readFile } from 'node:fs/promises';
import { verify } from '@codevibe_technology/sign-pdf';

const operatorCertificate = await readFile('seal-certificate.pem', 'utf8');
const result = await verify(new Uint8Array(await readFile('offer-signed.pdf')), {
  trust: { certificates: [operatorCertificate] },
});

if (result.valid) {
  console.log('Sealed by', result.signer?.commonName, 'at', result.signedAt, 'and unchanged');
} else {
  console.log('Not genuine:', result.reason);
}
```

`valid` is true only when the file has exactly one signature, the signature is intact, it
covers every byte of the file, and it was made with a certificate in `trust`. `reason` says
which check failed:

| `reason`              | Meaning                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `not_sealed`          | The file has no signature field with a signature.                           |
| `multiple_signatures` | More than one signature; the file was signed again after sealing.           |
| `signature_invalid`   | The signature does not match the bytes it covers: the file was changed.     |
| `not_whole_document`  | Bytes were appended after sealing (an incremental update).                  |
| `untrusted_signer`    | The seal is intact but made with a certificate you did not list in `trust`. |

`trust` takes `certificates` (PEM or DER), `fingerprints` (SHA-256 hex) or `roots` (a CA the
operator certificate was issued by). After a key rotation, list the old certificate too so
older files keep verifying.

The server runs the same check for each sealed document at
`GET /v1/envelopes/:id/documents/:docId/verification`, and returns the hashes and the chain
status at `GET /v1/envelopes/:id/certificate` and `chainValid` with every event at
`GET /v1/envelopes/:id/events`.

### `verify` and `verifySeal`

`verifySeal(bytes)` is the low-level check underneath. It reports whether the first
signature is intact (`valid`), whether it covers the whole file (`coversWholeDocument`) and
how many signatures there are, but not who made it: anyone can change a file and seal it
again with their own key, and `verifySeal` will call that seal valid. Use `verify` to decide
whether a file is genuine.

## Checking the audit chain

The audit chain is verified with `@codevibe_technology/sign-core`. Take the envelope's events
from your store or from `GET /v1/envelopes/:id/events`, and compare against the head printed
on the certificate page:

<!-- check:
import type { AuditEvent } from '@codevibe_technology/sign-core';
declare const events: AuditEvent[];
declare const headFromCertificate: string;
-->

```ts check
import { verifyChain, webCryptoHasher } from '@codevibe_technology/sign-core';

const check = await verifyChain(events, webCryptoHasher, { expectedHead: headFromCertificate });

if (check.valid) {
  console.log('Audit chain intact, head', check.head);
} else {
  console.log(`Chain broken at event ${check.brokenAt} (${check.reason})`);
}
```

If both the seal and the chain check out, the file is the one that was sealed and the recorded
history is the one that produced it.
