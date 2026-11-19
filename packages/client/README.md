# @codevibe/sign-client

A typed client for the Codevibe Sign HTTP API. One part sends envelopes from your server,
one part drives a signing session in the browser, and a helper checks webhook signatures.

No runtime dependencies. It uses the global `fetch` and Web Crypto, so it runs in Node 20+,
browsers, Deno, Bun and edge runtimes. Pass your own `fetch` to route requests anywhere,
including straight into an in-process server.

## Install

```sh
pnpm add @codevibe/sign-client
```

## Sending

```ts
import { readFile } from 'node:fs/promises';
import { createSignClient } from '@codevibe/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.example.com',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.create({
  title: 'Offer letter',
  send: true,
  documents: [{ key: 'offer', name: 'offer.pdf', content: await readFile('offer.pdf') }],
  recipients: [{ key: 'asha', name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' }],
  fields: [
    { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 640, width: 180, height: 48 },
  ],
  metadata: { employeeId: 'E-104' },
});

// Later, once the `envelope.completed` webhook arrives:
const pdf = await sign.envelopes.downloadDocument(envelope.id, envelope.documents[0]!.id, {
  version: 'sealed',
});
```

Field boxes are in PDF points from the top-left corner of the page. Documents can be a
`Uint8Array` (a Node `Buffer` is one), an `ArrayBuffer` or a `Blob`.

## Signing

In the browser, with the token from the signing link:

```ts
import { createSignerClient } from '@codevibe/sign-client';

const signer = createSignerClient({ baseUrl: 'https://sign.example.com', token });
const session = await signer.session();
if (session.otpRequired && !session.authenticated) {
  await signer.requestOtp();
  await signer.verifyOtp(codeTypedByTheSigner);
}
const pdf = await signer.document(session.documents[0]!.id);
await signer.view();
await signer.submit(values); // [{ fieldId, value }]
```

When the signing link goes through the server's `GET /sign/:token`, the server keeps the
token in an HttpOnly cookie and opens your page without it. Pass `token: 'link'` and serve the
page from the same origin as the API, and the cookie stands in for the token.

After `verifyOtp` the client sends the session in the `X-Sign-Session` header on every
later call. Read `signer.sessionToken` and pass it back as `sessionToken` to resume after a
page reload. `submit` sends `consent: true`: call it only after the signer has agreed.

## Webhooks

```ts
import { readWebhook } from '@codevibe/sign-client';

const delivery = await readWebhook(secret, req.headers['x-codevibe-signature'], rawBody);
if (delivery.type === 'envelope.completed') {
  // delivery.data.envelope.id, .metadata, .recipients
}
```

Pass the body exactly as received. `verifyWebhook(secret, header, rawBody, { toleranceSeconds })`
returns a boolean instead of throwing. Signatures older than five minutes are rejected.

## Errors, retries and idempotency

Every failure is a `SignApiError` with the server's `code` (such as `VALIDATION`,
`INVALID_STATE` or `OTP_INVALID`), the HTTP `status`, `details`, and `requestId` when an
`X-Request-Id` header came back. Validation problems are listed in `err.issues` as
`{ path, message }`. When no response arrived, `status` is 0 and `code` is `NETWORK`,
`TIMEOUT` or `ABORTED`.

Every POST carries an `Idempotency-Key`, generated unless you pass `idempotencyKey`, and the
server answers a repeat with the first response. That makes POSTs and GETs safe to retry:
they are retried on network errors, timeouts, 429 and 5xx, with exponential backoff and
`Retry-After` respected. PATCH (`update`) is never retried.

## API

| Call                                                                     | Returns                        |
| ------------------------------------------------------------------------ | ------------------------------ |
| `createSignClient({ baseUrl, apiKey, fetch?, timeoutMs?, retries? })`    | `SignClient`                   |
| `envelopes.create(input, options?)`                                      | `Envelope`                     |
| `envelopes.get(id)`, `update(id, patch)`, `send(id)`, `void(id, reason)` | `Envelope`                     |
| `envelopes.events(id)`                                                   | `{ events, chainValid }`       |
| `envelopes.downloadDocument(id, documentId, { version? })`               | `Uint8Array`                   |
| `envelopes.certificate(id)`                                              | `Certificate`                  |
| `createSignerClient({ baseUrl, token, sessionToken?, fetch? })`          | `SignerClient`                 |
| `session()`, `document(id)`                                              | `SigningSession`, `Uint8Array` |
| `requestOtp()`, `verifyOtp(code)`                                        | `OtpSent`, `OtpSession`        |
| `view()`, `submit(values)`, `decline(reason)`                            | `SignerActionResult`           |
| `verifyWebhook(secret, header, rawBody, options?)`                       | `Promise<boolean>`             |
| `readWebhook(secret, header, rawBody, options?)`                         | `WebhookDelivery`              |

Client options: `timeoutMs` per attempt (default 30 000), `retries` (default 2),
`retryDelayMs` backoff base (default 500). Every call takes `{ signal, idempotencyKey }`.

The domain types (`Envelope`, `Recipient`, `Field`, `FieldValue`, `AuditEvent` and the rest)
are those of `@codevibe/sign-core`, re-exported here so you need only this package.

## Licence

Apache-2.0 © Codevibe
