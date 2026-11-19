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

<ComingSoon pkg="@codevibe/sign-pdf" />

`verify()` from `@codevibe/sign-pdf` checks the PAdES seal and reads the certificate page:

```ts
import { verify } from '@codevibe/sign-pdf';

const result = await verify(await readFile('offer-signed.pdf'));
```

The result will report whether the seal is valid and return the details printed on the
certificate page, including the audit chain head.

## Checking the audit chain

The audit chain can be verified today with `@codevibe/sign-core`. Export the envelope's events
from your store and compare against the head printed on the certificate page:

```ts
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
