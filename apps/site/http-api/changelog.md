---
title: API changelog
description: Every change to version 1 of the Codevibe Sign HTTP API, newest first.
---

# Changelog

Every change to the HTTP API, newest first. The API is versioned as one unit under `/v1`, and
within it changes only add. [Versioning and deprecation](/http-api/versioning) says exactly
what counts as a breaking change and how much notice you get.

Version 1 is not yet declared stable. Until it is, a breaking change may still happen within
`/v1`; each one is marked **Breaking** below and in the package changelogs.

## Version 1

### November 2026

- **Documented**: the `PLAN_LIMIT` error code that a hosted install with plans already sends:
  `429` with `Retry-After` for the API request counts, `403` for every other plan limit. It is
  now part of the `ErrorCode` list in the OpenAPI document.
- **Added**: Aadhaar eSign. A signer can have `auth: "aadhaar"`; the signing page starts the
  eSign with `GET` and `POST /v1/sign/{token}/esign`, and the provider calls back on
  `POST /v1/esign/webhooks/{provider}`. New: the `ESIGN_UNAVAILABLE` error code, the
  `recipient.esign_started` and `recipient.esign_failed` events, and
  `?version=certificate` for the separate certificate of an Aadhaar-signed document.
- **Added**: templates. `GET`, `POST`, `PATCH` and `DELETE` under `/v1/templates`, and
  `POST /v1/templates/{templateId}/envelopes` to make an envelope from one.
- **Added**: public verification of sealed PDFs, `POST /v1/verify` and
  `GET /v1/verify/{sha256}`, with no API key.
- **Added**: every answer carries `Codevibe-Api-Version: 1`, and the
  [versioning and deprecation policy](/http-api/versioning) is written down.
- **Changed**: operations are grouped by resource (Envelopes, Recipients, Documents, Audit
  trail, Signing) and every error code has a one-line description in the document.
- **Added**: the cloud API, `https://sign.codevibe.in/api`, as a second server in the document.
- **Added**: signers are asked for a one-time code by default.
- **Added**: a time zone per workspace for dates in documents and emails.
- **Breaking**: envelope answers no longer include storage paths of documents.
- **Changed**: the signing session lists no document details until the one-time code is
  checked.
- **Added**: the `PDF_ALREADY_SIGNED` error code, for uploads that already carry digital
  signatures.
- **Added**: routes to fix an envelope after sending: correct a recipient, recall, revise and
  share a signing link.
- **Added**: `POST /v1/envelopes/{id}/remind` to remind recipients.
- **Added**: signer receipts and emailed download links for completed copies.
- **Added**: webhook delivery reports, test events and redelivery.
- **Added**: `GET /v1/envelopes` lists envelopes with filters and cursor pagination, including
  the decline reason.
- **Added**: the first OpenAPI 3.1 description of the API.

Release notes for each package are in its `CHANGELOG.md` and on the [changelog](/changelog)
page.
