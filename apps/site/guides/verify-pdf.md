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
still detecting changes.

## In code

`verifySeal` from `@codevibe/sign-pdf` checks the seal offline:

```ts check
import { readFile } from 'node:fs/promises';
import { verifySeal } from '@codevibe/sign-pdf';

const result = await verifySeal(new Uint8Array(await readFile('offer-signed.pdf')));

if (result.valid && result.coversWholeDocument) {
  console.log('Unchanged since it was sealed by', result.signer?.commonName, result.signedAt);
} else if (!result.sealed) {
  console.log('This file carries no seal');
} else {
  console.log('The file was changed after sealing');
}
```

It checks the first signature in the file: the byte range is well formed, the message digest
matches the signed bytes, the signing certificate matches the one embedded and the RSA
signature verifies. The result is:

| Field                 | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `sealed`              | The file carries a PDF signature.                                    |
| `valid`               | The signature is intact and matches the bytes it covers.             |
| `coversWholeDocument` | Nothing was appended after sealing.                                  |
| `signer`              | `{ commonName?, organization? }` from the sealing certificate.       |
| `signedAt`            | ISO time of the seal.                                                |
| `signatureCount`      | How many signatures the file has; the first one is the one verified. |

Treat `valid && coversWholeDocument` as "unchanged since sealing". `valid` does not say whether
the certificate is trusted: compare `signer` with the operator's certificate you expect.

The server also returns the hashes and the chain status for an envelope at
`GET /v1/envelopes/:id/certificate`, and `chainValid` with every event at
`GET /v1/envelopes/:id/events`.

## Checking the audit chain

The audit chain is verified with `@codevibe/sign-core`. Take the envelope's events
from your store or from `GET /v1/envelopes/:id/events`, and compare against the head printed
on the certificate page:

<!-- check:
import type { AuditEvent } from '@codevibe/sign-core';
declare const events: AuditEvent[];
declare const headFromCertificate: string;
-->

```ts check
import { verifyChain, webCryptoHasher } from '@codevibe/sign-core';

const check = await verifyChain(events, webCryptoHasher, { expectedHead: headFromCertificate });

if (check.valid) {
  console.log('Audit chain intact, head', check.head);
} else {
  console.log(`Chain broken at event ${check.brokenAt} (${check.reason})`);
}
```

If both the seal and the chain check out, the file is the one that was sealed and the recorded
history is the one that produced it.
