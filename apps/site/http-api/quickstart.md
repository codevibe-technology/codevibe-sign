---
title: Quickstart
description: Get an API key, send a PDF for signature, follow it with a webhook and download the sealed copy, in about five minutes.
---

# Quickstart

Send a PDF for signature, follow it to completion and download the sealed copy. You need a
PDF to send and about five minutes.

## 1. Get an API key

::: code-group

```sh [Local sandbox]
npx @codevibe_technology/sign-server start --memory
# Prints the API URL (http://localhost:3000) and a fresh API key.
# Emails and one-time codes are printed instead of sent.
```

```text [Cloud]
Dashboard > Settings > API keys > Create key

The key starts with cvs_ and is shown once. Store it in your secret manager.
```

:::

The sandbox keeps everything in memory, so it is the safe place to try requests: nothing is
sent and nothing is kept. Put the key in your shell for the next steps:

```sh
export SIGN_API_KEY=<your key>
export SIGN_URL=http://localhost:3000   # or https://sign.codevibe.in/api
```

## 2. Send an envelope

One request uploads the PDF, names the signer, places a signature field and sends it. Field
boxes are in PDF points from the top-left corner of the page.

::: code-group

```sh [curl]
curl -X POST "$SIGN_URL/v1/envelopes" \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Idempotency-Key: offer-E-1042" \
  -H "Content-Type: application/json" \
  -d '{
  "title": "Offer letter",
  "send": true,
  "documents": [
    { "key": "offer", "name": "offer.pdf", "content": "'"$(base64 < offer.pdf | tr -d '\n')"'" }
  ],
  "recipients": [
    { "key": "asha", "name": "Asha Rao", "email": "asha@example.com", "auth": "email_otp" }
  ],
  "fields": [
    { "recipient": "asha", "type": "signature", "page": 0, "x": 72, "y": 640, "width": 180, "height": 48 }
  ],
  "metadata": { "employeeId": "E-1042" }
}'
```

```ts check [Node.js]
import { readFile } from 'node:fs/promises';
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: process.env.SIGN_URL!,
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.create(
  {
    title: 'Offer letter',
    send: true,
    documents: [{ key: 'offer', name: 'offer.pdf', content: await readFile('offer.pdf') }],
    recipients: [{ key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' }],
    fields: [
      { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 640, width: 180, height: 48 },
    ],
    metadata: { employeeId: 'E-1042' },
  },
  { idempotencyKey: 'offer-E-1042' },
);

console.log(envelope.id, envelope.status); // "7f3c9a2e-...", "sent"
```

```python [Python]
import base64
import os

import requests

with open("offer.pdf", "rb") as file:
    pdf = base64.b64encode(file.read()).decode()

response = requests.post(
    f"{os.environ['SIGN_URL']}/v1/envelopes",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
        "Idempotency-Key": "offer-E-1042",
    },
    json={
        "title": "Offer letter",
        "send": True,
        "documents": [{"key": "offer", "name": "offer.pdf", "content": pdf}],
        "recipients": [
            {"key": "asha", "name": "Asha Rao", "email": "asha@example.com", "auth": "email_otp"}
        ],
        "fields": [
            {"recipient": "asha", "type": "signature", "page": 0,
             "x": 72, "y": 640, "width": 180, "height": 48}
        ],
        "metadata": {"employeeId": "E-1042"},
    },
    timeout=30,
)
response.raise_for_status()
envelope = response.json()
print(envelope["id"], envelope["status"])
```

:::

The answer is the [envelope](/http-api/reference/envelopes#the-envelope-object) with
`status: "sent"`. Keep its `id`. The `Idempotency-Key` makes the request safe to retry: sending
it again returns the same envelope instead of creating a second one.

Asha now gets an email with her signing link. In the sandbox the link and her one-time code are
printed in the terminal instead: open the link, enter the code and sign.

## 3. Follow it

Do not poll. Add a webhook target for `envelope.completed` (in the server options, or under
**Settings > Webhooks** on the cloud) and the server posts the event to you the moment the last
recipient signs. Verify the signature before you trust it:

```ts check
import { readWebhook } from '@codevibe_technology/sign-client';

export async function onWebhook(signature: string | null, rawBody: string) {
  const delivery = await readWebhook(process.env.SIGN_WEBHOOK_SECRET!, signature, rawBody);
  if (delivery.type === 'envelope.completed') {
    // delivery.data.envelope.id and .metadata.employeeId tell you which offer it was.
  }
}
```

The [webhooks reference](/http-api/reference/webhooks#verify-a-delivery) has the same check in
Python and Go, and every field of the payload. To look an envelope up yourself, call
[Get an envelope](/http-api/reference/envelopes#get-envelope).

## 4. Download the sealed PDF

Once the envelope is `completed`, its documents are sealed with a PAdES signature that any PDF
reader can check, and the audit trail is attached.

```sh
curl "$SIGN_URL/v1/envelopes/<envelope id>/documents/<document id>?version=sealed" \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -o offer-sealed.pdf

npx codevibe-sign verify offer-sealed.pdf
```

## Next

- [Authentication](/http-api/authentication): keys, read-only credentials and signing tokens.
- [Pagination and retries](/http-api/conventions): idempotency, rate limits and listing.
- [Errors](/http-api/errors): what each code means and which ones to retry.
- [Embed the signing page](/guides/react-signing-view) in your own product instead of using the
  emailed link.
