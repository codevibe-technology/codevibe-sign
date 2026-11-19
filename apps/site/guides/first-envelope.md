---
title: Send your first envelope
description: Build a draft envelope, add a document, a signer and a signature field, send it and record the signature, using the core rules.
---

# Send your first envelope

This guide uses `@codevibe/sign-core` directly, so you can see every step. With the server,
the same steps happen behind its HTTP API.

```sh
pnpm add @codevibe/sign-core
```

## 1. Create a draft

```ts
import { createEnvelope, randomIds, systemClock } from '@codevibe/sign-core';

const deps = { clock: systemClock, ids: randomIds };

const created = createEnvelope({ title: 'Offer letter', routing: 'sequential' }, deps);
let envelope = created.envelope;
```

`createEnvelope` returns a transition result: the envelope, an `envelope.created` audit event
and no effects.

## 2. Add the document

Core does not read PDFs. Give it the file's hash, its page count and page sizes, and the key
under which you stored the bytes.

```ts
import { addDocument, webCryptoHasher } from '@codevibe/sign-core';

const pdf = await readFile('offer.pdf');
const sha256 = await webCryptoHasher.sha256(pdf);
await files.put('files/offer.pdf', pdf, 'application/pdf');

const doc = addDocument(
  envelope,
  {
    name: 'offer.pdf',
    sha256,
    pageCount: 2,
    fileKey: 'files/offer.pdf',
    pageSizes: [
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ],
  },
  deps,
);
envelope = doc.envelope;
```

## 3. Add a signer and a field

```ts
import { addField, addRecipient } from '@codevibe/sign-core';

const asha = addRecipient(
  envelope,
  { name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
  deps,
);
envelope = asha.envelope;

envelope = addField(
  envelope,
  {
    documentId: doc.document.id,
    recipientId: asha.recipient.id,
    type: 'signature',
    page: 1,
    rect: { x: 72, y: 640, width: 180, height: 48 },
  },
  deps,
).envelope;
```

`page` is zero-based, so `1` is the second page. Coordinates are PDF points from the top-left
corner; see [Fields and coordinates](/concepts/fields).

## 4. Check and send

```ts
import { commitTransition, send, validateForSend } from '@codevibe/sign-core';

const issues = validateForSend(envelope, new Date());
if (issues.length > 0) throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join('\n'));

const sent = await commitTransition(send(envelope, deps), storedEventCount + 1, webCryptoHasher);
await store.save(sent.envelope, sent.events);

for (const effect of sent.effects) {
  if (effect.kind === 'notify') await inviteRecipient(sent.envelope, effect.recipientId);
  if (effect.kind === 'webhook') await queueWebhook(effect);
}
```

`commitTransition` chains the new events after the envelope's current audit head. Save the
envelope and its events together, then perform the effects.

## 5. Record the signature

When Asha opens her link, passes the code check and submits:

```ts
import { markAuthenticated, markViewed, submit } from '@codevibe/sign-core';

const context = { ip, userAgent };
let result = markViewed(envelope, { recipientId: asha.recipient.id, context }, deps);
// ...commit and save, then after verifyOtp succeeds:
result = markAuthenticated(result.envelope, { recipientId: asha.recipient.id, context }, deps);
// ...commit and save, then:
result = submit(
  result.envelope,
  { recipientId: asha.recipient.id, values: [{ fieldId, value: signaturePng }], context },
  deps,
);
```

When the last required action is done, the envelope becomes `completed` and the effects include
`{ kind: 'seal' }`. That is the signal to produce the sealed PDF; see
[Sealing and verification](/concepts/sealing).

## With the server

<ComingSoon pkg="@codevibe/sign-server" />

The server will expose the same steps over HTTP, authenticated with an API key, and will store
the envelope, send the emails and codes, fire webhooks and seal the file for you.
