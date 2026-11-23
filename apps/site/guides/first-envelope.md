---
title: Send your first envelope
description: Build a draft envelope, add a document, a signer and a signature field, send it and record the signature, using the core rules.
---

# Send your first envelope

This guide uses `@codevibe_technology/sign-core` directly, so you can see every step. With the server,
the same steps happen behind its HTTP API.

```sh
pnpm add @codevibe_technology/sign-core
```

## 1. Create a draft

```ts check
import { createEnvelope, randomIds, systemClock } from '@codevibe_technology/sign-core';

const deps = { clock: systemClock, ids: randomIds };

const created = createEnvelope({ title: 'Offer letter', routing: 'sequential' }, deps);
let envelope = created.envelope;
```

`createEnvelope` returns a transition result: the envelope, an `envelope.created` audit event
and no effects.

## 2. Add the document

Core does not read PDFs. Give it the file's hash, its page count and page sizes, and the key
under which you stored the bytes.

<!-- check:
import { randomIds, systemClock, type Document, type Effect, type Envelope, type FileStore, type Recipient } from '@codevibe_technology/sign-core';
import { readFile } from 'node:fs/promises';
const deps = { clock: systemClock, ids: randomIds };
declare let envelope: Envelope;
declare const files: FileStore;
-->

```ts check
import { addDocument, webCryptoHasher } from '@codevibe_technology/sign-core';

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

<!-- check:
import { randomIds, systemClock, webCryptoHasher, type Document, type Effect, type Envelope, type FileStore, type Recipient } from '@codevibe_technology/sign-core';
import { readFile } from 'node:fs/promises';
const deps = { clock: systemClock, ids: randomIds };
declare let envelope: Envelope;
declare const doc: { document: Document };
-->

```ts check
import { addField, addRecipient } from '@codevibe_technology/sign-core';

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

<!-- check:
import { randomIds, systemClock, webCryptoHasher, type Document, type Effect, type Envelope, type FileStore, type Recipient } from '@codevibe_technology/sign-core';
import { readFile } from 'node:fs/promises';
const deps = { clock: systemClock, ids: randomIds };
declare let envelope: Envelope;
declare const storedEventCount: number;
declare const store: { save(envelope: Envelope, events: unknown[]): Promise<void> };
declare function inviteRecipient(envelope: Envelope, recipientId: string): Promise<void>;
declare function queueWebhook(effect: Effect): Promise<void>;
-->

```ts check
import { commitTransition, send, validateForSend } from '@codevibe_technology/sign-core';

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

<!-- check:
import { randomIds, systemClock, webCryptoHasher, type Document, type Effect, type Envelope, type FileStore, type Recipient } from '@codevibe_technology/sign-core';
import { readFile } from 'node:fs/promises';
const deps = { clock: systemClock, ids: randomIds };
declare let envelope: Envelope;
declare const asha: { recipient: Recipient };
declare const ip: string;
declare const userAgent: string;
declare const fieldId: string;
declare const signaturePng: string;
-->

```ts check
import { markAuthenticated, markViewed, submit } from '@codevibe_technology/sign-core';

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

`@codevibe_technology/sign-server` runs these steps for you behind an HTTP API: it stores the envelope,
emails the links and codes, fires webhooks and seals the file. Your backend makes one call to
create and send:

```ts check
import { readFile } from 'node:fs/promises';

const SIGN_URL = 'https://sign.example.com';
const headers = {
  authorization: `Bearer ${process.env.SIGN_API_KEY}`,
  'content-type': 'application/json',
  'idempotency-key': 'offer-E42',
};

const pdf = await readFile('offer.pdf');
const res = await fetch(`${SIGN_URL}/v1/envelopes`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    title: 'Offer letter',
    routing: 'sequential',
    send: true,
    metadata: { employeeId: 'E42' },
    documents: [{ key: 'offer', name: 'offer.pdf', content: pdf.toString('base64') }],
    recipients: [
      { key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
      { key: 'hr', name: 'Meera Iyer', email: 'hr@example.com', role: 'viewer' },
    ],
    fields: [
      {
        recipient: 'asha',
        document: 'offer',
        type: 'signature',
        page: 1,
        x: 72,
        y: 640,
        width: 180,
        height: 48,
      },
    ],
  }),
});
const envelope = (await res.json()) as { id: string; documents: { id: string }[] };
```

Asha gets an email with her link. She verifies the code, fills her field and signs on the
signing page, which you can build with the [React signing view](/guides/react-signing-view).
Once everyone has acted, the server seals the PDF, emails the copies and sends a
`document.sealed` [webhook](/guides/webhooks). Download the sealed file with:

<!-- check:
declare const SIGN_URL: string;
declare const envelope: { id: string; documents: { id: string }[] };
-->

```ts check
const documentId = envelope.documents[0]!.id;
const sealed = await fetch(`${SIGN_URL}/v1/envelopes/${envelope.id}/documents/${documentId}`, {
  headers: { authorization: `Bearer ${process.env.SIGN_API_KEY}` },
});
```

Leave out `send: true` to create a draft, change it with `PATCH /v1/envelopes/:id` and send it
with `POST /v1/envelopes/:id/send`. The full list of routes is in the
[server reference](/api/server#sending).

## Next

- [Templates over the API](/guides/templates)
- [HTTP API quickstart](/http-api/quickstart)
