---
title: HTTP API
description: How the Codevibe Sign HTTP API works - authentication, signing sessions, errors, retries, rate limits and webhooks - with the OpenAPI document and a Postman collection.
---

# HTTP API

The server speaks plain JSON over HTTP. Your backend sends documents with an API key; the
recipient's browser signs with the token from their link. The whole API is described in an
OpenAPI 3.1 document, so you can read it, try it and generate clients from it.

- [**Interactive reference**](/http-api/reference): every route with its schemas and examples, and a
  **Test Request** button that calls your own server.
- [**Run a local sandbox**](/http-api/sandbox): a server on your machine with in-memory storage and an
  API key, ready for the reference to call.
- [**`openapi.json`**](/openapi.json): the OpenAPI document. Every server also serves its own
  copy at `GET /v1/openapi.json`.
- [**Postman collection**](/codevibe-sign.postman_collection.json): import it into Postman or
  Insomnia, set `baseUrl` and `apiKey`, and run the requests in order. Creating an envelope
  fills in `envelopeId` and `docId` for the requests after it. Insomnia can also import
  `openapi.json` directly.

The TypeScript packages wrap the same routes: `@codevibe_technology/sign-client` for your
backend and the signing page, and [`@codevibe_technology/sign-server`](/api/server) for the
server itself.

## Authentication

| Who                 | How                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your backend        | `Authorization: Bearer <api key>` on every `/v1/envelopes` route. Keys come from the server's `apiKeys` option.                                                                                                                  |
| The signer          | The signing token in the path: `/v1/sign/<token>/...`. It is the 43-character value from the signing link.                                                                                                                       |
| An OTP signer       | After `POST /v1/sign/<token>/otp/verify`, the session as the `X-Sign-Session` header or the `cvsign_session` cookie. It lasts 30 minutes.                                                                                        |
| A browser from mail | `GET /sign/<token>` moves the token into an HttpOnly `cvsign_link` cookie and redirects to the signing page; the page then calls `/v1/sign/link/...` from the same origin. See [OTP and signing links](/concepts/otp-and-links). |

`GET /health` and `GET /v1/openapi.json` need no authentication.

## Errors

Every error has the same body, and each code always comes with the same status:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "recipients[0].email is not a valid email address",
    "details": { "issues": [{ "path": "recipients[0].email", "message": "..." }] }
  }
}
```

| Status | Codes                                                                |
| ------ | -------------------------------------------------------------------- |
| 400    | `VALIDATION`                                                         |
| 401    | `UNAUTHORIZED`, `TOKEN_INVALID`, `OTP_INVALID`, `OTP_EXPIRED`        |
| 403    | `FIELD_NOT_YOURS`                                                    |
| 404    | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND`, `NOT_FOUND`             |
| 409    | `INVALID_STATE`, `NOT_YOUR_TURN`, `CONFLICT`                         |
| 410    | `ENVELOPE_EXPIRED`                                                   |
| 413    | `DOCUMENT_TOO_LARGE`                                                 |
| 422    | `REQUIRED_FIELDS_MISSING`, `INVALID_FIELD_VALUE`, `DOCUMENT_INVALID` |
| 423    | `OTP_LOCKED`                                                         |
| 429    | `RATE_LIMITED`                                                       |
| 500    | `SEAL_FAILED`, `INTERNAL`                                            |
| 502    | `PROVIDER_ERROR`, `WEBHOOK_INVALID`                                  |

Branch on `code`, not on `message`: messages are for people and may change.

## Retries and rate limits

POST routes take an `Idempotency-Key` header. Retrying with the same key and body within 24
hours returns the first response, marked `Idempotent-Replayed: true`, so a timeout never
creates two envelopes. Server errors are not stored and can be retried with the same key.

Over a limit, the answer is `429 RATE_LIMITED` with a `Retry-After` header in seconds. Limits
apply per API key (creating envelopes), per signing token and client IP (signer routes) and per
recipient (one-time codes); see `limits` in the [server options](/api/server).

## Webhooks

Deliveries are described in the `webhooks` section of the document: the body, the
`x-codevibe-delivery` id and the `x-codevibe-signature` header,
`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. The [webhooks guide](/guides/webhooks)
shows how to verify them.

## Calling the API from a browser

The server sends no CORS headers, so a page on another origin cannot call it. That is the
safe default for an API that takes secret keys. For the interactive reference, either:

- run the [local sandbox](/http-api/sandbox), which wraps the server with CORS for the docs origins; or
- serve the docs and the API from one origin. The docs' dev server proxies `/v1`, `/sign` and
  `/health` to a server when you start it with `SIGN_SERVER`:

  ```sh
  SIGN_SERVER=http://localhost:3000 pnpm --filter site dev
  ```

  Then enter the docs' own address, `http://localhost:5173`, as the server URL.

In production, keep sender API keys on your backend. Only the signing routes are meant to be
called from browsers, from the signing page on your own origin.
