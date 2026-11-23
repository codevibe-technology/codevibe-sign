---
title: Aadhaar eSign with Leegality
description: Add Aadhaar eSign to your signing flow through your own Leegality account, from workflow setup to fetching the signed PDF.
---

# Aadhaar eSign with Leegality

Use Aadhaar eSign where a law asks for a document to be signed in the statutory sense
(IT Act s.3A). For offer letters, policies and most business documents the built-in signature
is usually enough; see [Legal](/legal).

`@codevibe_technology/sign-aadhaar` is a standalone library. The Codevibe Sign server and the
web app do not call it yet, so the steps below run in your own backend.

## You need your own provider account

Codevibe Sign does not resell eSign. You sign up with Leegality, buy eSign credits from them
and give the package your API credentials. Each eSign is billed to your account.

## 1. Set up the Leegality workflow

Leegality's API runs a published workflow, and several settings live only there. In the
Leegality dashboard, for the workflow you will pass as `profileId`:

- choose Aadhaar eSign as the signature type for the invitee;
- place the signature box (create one workflow per layout if you need several);
- under the invitee's custom URLs and webhooks, set the Webhook and Error Webhook to your
  callback URL, choose webhook version 2.5, and set the Redirect URL.

## 2. Create the provider

```sh
pnpm add @codevibe_technology/sign-aadhaar @codevibe_technology/sign-core
```

```ts check
import { createLeegalityProvider } from '@codevibe_technology/sign-aadhaar';

const esign = createLeegalityProvider({
  environment: 'sandbox',
  authToken: process.env.LEEGALITY_AUTH_TOKEN!,
  privateSalt: process.env.LEEGALITY_PRIVATE_SALT!,
  profileId: process.env.LEEGALITY_WORKFLOW_ID!,
});
```

Start with `sandbox` and switch to `production` when you go live.

## 3. Create a request and send the signer

<!-- check:
import { createLeegalityProvider } from '@codevibe_technology/sign-aadhaar';
import type { Envelope } from '@codevibe_technology/sign-core';
declare const esign: ReturnType<typeof createLeegalityProvider>;
declare const envelope: Envelope;
declare const pdf: Uint8Array;
-->

```ts check
const { providerRef, signUrl } = await esign.createRequest({
  envelopeId: envelope.id,
  recipient: { name: 'Asha Rao', email: 'asha@example.com' },
  documentBytes: pdf,
  documentName: 'Appointment letter.pdf',
  signaturePositions: [{ page: 0, rect: { x: 72, y: 640, width: 160, height: 48 } }],
  callbackUrl: 'https://sign.example.com/hooks/leegality',
  redirectUrl: 'https://sign.example.com/done',
});
```

Store `providerRef` with the recipient and send them to `signUrl`. They review the document and
sign with an Aadhaar OTP on Leegality's page.

## 4. Handle the webhook

Pass the raw body exactly as received:

<!-- check:
import { createLeegalityProvider } from '@codevibe_technology/sign-aadhaar';
declare const esign: ReturnType<typeof createLeegalityProvider>;
declare const request: { headers: Headers };
declare const rawBody: string;
-->

```ts check
const event = await esign.parseWebhook(request.headers, rawBody);

if (event?.status === 'signed') {
  const signed = await esign.fetchSignedDocument(event.providerRef);
  // Store the file and record the signature in the envelope's audit trail.
}
```

`parseWebhook` throws `SignError('WEBHOOK_INVALID')` for a body it cannot verify, and returns
`null` for a verified callback that does not change the signer's status. By default it also
confirms each webhook with Leegality's status API, because the documented webhook signature
covers only the document id.

## Things to know

- Signature positions, callback URL and redirect URL come from the workflow; Leegality's
  create request API does not take them.
- Webhooks carry no signing time. Record the time you received the verified event.
- Provider failures throw `PROVIDER_ERROR` with `details.reason` and `details.retryable`;
  HTTP 429 throws `RATE_LIMITED`. Errors never contain the document or your credentials.

The full list of options is in the [API reference](/api/aadhaar).

## Other providers

Implement the `EsignProvider` interface (`createRequest`, `parseWebhook`,
`fetchSignedDocument`) to add another eSign provider. Pull requests are welcome.
