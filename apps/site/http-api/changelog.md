---
title: API versioning and changelog
description: How the Codevibe Sign HTTP API is versioned, what counts as a breaking change, and every change to version 1.
---

# Versioning and changelog

The API version is in the path. Every route is under `/v1`, and the OpenAPI document of a
server, `GET /v1/openapi.json`, always describes exactly what that server answers.

**Additive changes** come without notice: new routes, new optional request fields, new response
fields, new webhook event types and new error codes. Write clients that ignore unknown fields
and that branch on error `code`, not on `message`.

**Breaking changes**, such as removing a field or changing what a status means, get a new
version path, announced here before the old one is retired. Before the first stable release, a breaking change may happen within `v1`; it is marked
**Breaking** below and in the package changelogs.

## Version 1

### November 2026

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
