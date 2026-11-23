---
title: "Errors"
description: "Every error code of the Codevibe Sign HTTP API, the HTTP status it comes with, and what to do about it."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

# Errors

Every error has the same JSON body. `code` is stable and always comes with the same HTTP status; `message` is for people and may change, so branch on `code`. `details` carries extra facts for some codes.

::: code-group

```json [400 Bad Request]
{
  "error": {
    "code": "VALIDATION",
    "message": "recipients[0].email is not a valid email address",
    "details": {
      "issues": [
        {
          "path": "recipients[0].email",
          "message": "recipients[0].email is not a valid email address"
        }
      ]
    }
  }
}
```

:::

With the Node.js client every failure is a `SignApiError` carrying `code`, `status`, `details` and `requestId`. When no response arrived at all, `status` is `0` and `code` is `NETWORK`, `TIMEOUT` or `ABORTED`.

## Codes {#codes}

| Code | Status | Meaning |
| ---- | ------ | ------- |
| <span id="validation">`VALIDATION`</span> | 400 Bad Request | The request is malformed. `details.issues` lists each problem as `{ path, message }`. |
| <span id="unauthorized">`UNAUTHORIZED`</span> | 401 Unauthorized | The API key is missing or not valid. |
| <span id="token-invalid">`TOKEN_INVALID`</span> | 401 Unauthorized | The signing link is unknown, already used, expired or withdrawn. |
| <span id="otp-invalid">`OTP_INVALID`</span> | 401 Unauthorized | The one-time code is wrong (`details.attemptsLeft`), or the signing session is missing (`details.otpRequired`). |
| <span id="otp-expired">`OTP_EXPIRED`</span> | 401 Unauthorized | The one-time code timed out, or none was sent. |
| <span id="field-not-yours">`FIELD_NOT_YOURS`</span> | 403 Forbidden | A value names a field that belongs to another recipient. |
| <span id="forbidden">`FORBIDDEN`</span> | 403 Forbidden | The credential may only read; only `GET` routes are allowed. |
| <span id="envelope-not-found">`ENVELOPE_NOT_FOUND`</span> | 404 Not Found | No envelope with this id in the caller's workspace. |
| <span id="recipient-not-found">`RECIPIENT_NOT_FOUND`</span> | 404 Not Found | No recipient with this id on the envelope. |
| <span id="not-found">`NOT_FOUND`</span> | 404 Not Found | No route or document at this address. |
| <span id="invalid-state">`INVALID_STATE`</span> | 409 Conflict | Not allowed in the envelope's current status (`details.status`). |
| <span id="not-your-turn">`NOT_YOUR_TURN`</span> | 409 Conflict | Sequential routing, and an earlier recipient has not acted yet. |
| <span id="conflict">`CONFLICT`</span> | 409 Conflict | Another request changed the envelope, or one with the same `Idempotency-Key` is still running. Try again. |
| <span id="envelope-expired">`ENVELOPE_EXPIRED`</span> | 410 Gone | The envelope is past its expiry date. |
| <span id="document-too-large">`DOCUMENT_TOO_LARGE`</span> | 413 Content Too Large | A PDF or the whole request is over the size limit (`details.maxBytes`). |
| <span id="required-fields-missing">`REQUIRED_FIELDS_MISSING`</span> | 422 Unprocessable Content | Required fields were left empty. |
| <span id="invalid-field-value">`INVALID_FIELD_VALUE`</span> | 422 Unprocessable Content | A value does not suit its field, for example a signature that is not a PNG or a date that does not parse. |
| <span id="document-invalid">`DOCUMENT_INVALID`</span> | 422 Unprocessable Content | A file is not a readable PDF. |
| <span id="pdf-already-signed">`PDF_ALREADY_SIGNED`</span> | 422 Unprocessable Content | A file already carries digital signatures. Upload the unsigned original. |
| <span id="otp-locked">`OTP_LOCKED`</span> | 423 Locked | Too many wrong guesses, or too many codes for this envelope (`details.reason`). |
| <span id="rate-limited">`RATE_LIMITED`</span> | 429 Too Many Requests | Too many requests. Wait the number of seconds in `Retry-After`. |
| <span id="seal-failed">`SEAL_FAILED`</span> | 500 Internal Server Error | The sealed PDF could not be produced. Safe to retry with the same `Idempotency-Key`. |
| <span id="internal">`INTERNAL`</span> | 500 Internal Server Error | An unexpected server error. Safe to retry with the same `Idempotency-Key`. |
| <span id="provider-error">`PROVIDER_ERROR`</span> | 502 Bad Gateway | An outside provider, such as an Aadhaar eSign service, failed or answered with something unexpected. |
| <span id="webhook-invalid">`WEBHOOK_INVALID`</span> | 502 Bad Gateway | A provider's callback could not be verified. |

## Retrying {#retrying}

- `429 RATE_LIMITED`: wait the number of seconds in the `Retry-After` header, then retry.
- `500` and `502`: retry with backoff, sending the same `Idempotency-Key` so nothing is created twice.
- `409 CONFLICT`: another request got there first. Fetch the envelope again and retry if it still makes sense.
- Every other `4xx`: fix the request first. Sending it again unchanged gets the same answer.
