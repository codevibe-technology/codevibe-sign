---
title: '@codevibe_technology/sign-aadhaar'
description: API reference for @codevibe_technology/sign-aadhaar - the EsignProvider interface and the Leegality adapter for Aadhaar eSign.
---

# @codevibe_technology/sign-aadhaar

Aadhaar eSign through an eSign provider you hold an account with. It defines a small
`EsignProvider` interface and ships an adapter for [Leegality](https://www.leegality.com). For a
walkthrough, see [Aadhaar eSign with Leegality](/guides/aadhaar-leegality).

The Codevibe Sign server and the web app run it for you: a recipient with `auth: 'aadhaar'`
is sent to the provider, the callback is verified, the signed file is kept and sealed, and the
audit trail records it. You can also call the provider from your own backend and store the
signed file yourself.

```sh
pnpm add @codevibe_technology/sign-aadhaar @codevibe_technology/sign-core
```

Node 22 or later. The package uses `fetch` and `node:crypto`.

| Export                    | What it is                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `EsignProvider`           | `createRequest`, `parseWebhook`, `fetchSignedDocument`, and optionally `webhookRef` and `checkCredentials`. Implement it to add a provider. |
| `EsignRequest`            | `envelopeId`, `reference`, `recipient`, `documentBytes`, `documentName`, `signaturePositions`, `callbackUrl`, `redirectUrl`.                |
| `EsignEvent`              | `{ providerRef, status, signerName?, signedAt? }`.                                                                                          |
| `createLeegalityProvider` | The Leegality adapter. Options below.                                                                                                       |
| `computeLeegalityMac`     | The webhook `mac` for a document id, for tests and tooling.                                                                                 |
| `leegalityWebhookRef`     | The document id a Leegality webhook body names, read without verifying it.                                                                  |

`reference` is your own id for one request, sent to Leegality as the `irn`; it defaults to
`envelopeId`. Give each attempt its own when a signer can start again.

`webhookRef(rawBody)` reads the provider reference from a callback without checking anything.
A server that holds several provider accounts uses it to find whose credentials must verify
the callback; never act on it before `parseWebhook` has accepted the same body.

`checkCredentials()` makes one read-only call and resolves when the provider accepts the
credentials; any other answer throws `SignError('PROVIDER_ERROR')`.

`parseWebhook` throws `SignError('WEBHOOK_INVALID')` for any body it cannot verify, and returns
`null` for a verified callback that does not change the signer's status (such as a reviewer
approval). Provider failures throw `SignError('PROVIDER_ERROR')` with `details.reason`
(`timeout`, `network`, `unauthorized`, `unavailable`, `rejected`, `not_found`, ...) and
`details.retryable`; HTTP 429 throws `RATE_LIMITED`. Errors never contain the document or your
credentials, and the package does not log.

## Leegality options

| Option                   | Required | Notes                                                                                               |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------- |
| `environment`            | yes      | `sandbox` (`https://sandbox.leegality.com/api`) or `production` (`https://app1.leegality.com/api`). |
| `authToken`              | yes      | Dashboard, API Settings. Sent as `X-Auth-Token`.                                                    |
| `privateSalt`            | yes      | Dashboard, API Settings. Verifies webhook `mac`.                                                    |
| `profileId`              | yes      | The Workflow ID, or a function `(request) => workflowId`.                                           |
| `confirmWebhooks`        | no       | Default `true`. Confirms each webhook with the Check transaction status API.                        |
| `webhookHeader`          | no       | `{ name, value }` of a static header Leegality support adds to your webhooks.                       |
| `timeoutMs`              | no       | Default 30 000, covering the response body as well.                                                 |
| `maxSignedDocumentBytes` | no       | Default 50 MB.                                                                                      |
| `baseUrl`, `fetch`       | no       | Overrides for proxies and tests.                                                                    |

## Set up the Leegality workflow

Leegality's API runs a published Workflow; several settings live only in that workflow, not in the
API request. In the Leegality dashboard, for the workflow you pass as `profileId`:

- choose Aadhaar eSign as the signature type for the invitee;
- place the signature box (if you need different layouts, create a workflow per layout and pass
  `profileId` as a function);
- under the invitee's custom URLs and webhooks, set the Webhook and Error Webhook to your
  `callbackUrl`, choose webhook version 2.5, and set the Redirect URL to your `redirectUrl`.

## What Leegality's public documentation does not cover

The adapter only does what Leegality's published API reference confirms. These gaps are handled
by configuration rather than guessed:

- **Signature positions, callback URL and redirect URL** are not fields of the Create eSigning
  request API. They come from the workflow (see above), so `signaturePositions`, `callbackUrl`
  and `redirectUrl` are not sent.
- **Choosing Aadhaar per request** is not documented; the workflow decides the eSign type.
- **Webhook authenticity**: the documented `mac` is HMAC-SHA1 of the `documentId` only, keyed by
  the Private Salt. The rest of the body is not covered, and no timestamp or replay protection
  is documented. That is why `confirmWebhooks` is on by default. The hex encoding is taken from
  the documented examples.
- **Signing time**: no webhook or status field gives the time of signing, so `signedAt` is not
  set. Record the time you received the verified event instead.
- **HTTP status codes**: the reference says errors usually come back as HTTP 200 with
  `status: 0`. Other status codes and rate limits ("fair use limits may apply") are not
  specified, so they are mapped generically.
- **Response `status` on success**: the published sample shows `status: 0` beside a success
  message, so a returned `documentId` is treated as success.
- **Webhook versions** other than 2.5 are not documented in the API reference.

## Providers

Leegality is the only adapter today. eMudhra is planned as the second provider, behind the
same `EsignProvider` interface.
