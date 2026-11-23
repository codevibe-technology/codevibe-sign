---
title: Pagination and retries
description: How the Codevibe Sign API pages through lists, makes retries safe with idempotency keys, limits request rates and versions its routes.
---

# Pagination and retries

## Requests and responses

- Bodies are JSON (`Content-Type: application/json`), except PDF downloads and the optional
  multipart upload of documents.
- Times are ISO 8601 in UTC, such as `2026-03-02T09:14:31.000Z`. Ids are opaque strings.
- PDF bytes in JSON are base64. Field boxes are in PDF points from the top-left corner of the
  page.

## Pagination {#pagination}

[List envelopes](/http-api/reference/envelopes#list-envelopes) and
[list templates](/http-api/reference/templates#list-templates) return one page at a time,
newest first. Each page has `envelopes` and `nextCursor`; pass the cursor back as `cursor` to get
the next page. On the last page `nextCursor` is `null`.

```ts check
declare function request(
  path: string,
): Promise<{ envelopes: { id: string }[]; nextCursor: string | null }>;

let cursor: string | null = null;
do {
  const query = new URLSearchParams({ status: 'sent,in_progress', limit: '100' });
  if (cursor) query.set('cursor', cursor);
  const page = await request(`/v1/envelopes?${query}`);
  for (const envelope of page.envelopes) console.log(envelope.id);
  cursor = page.nextCursor;
} while (cursor);
```

`limit` is 1 to 100 and defaults to 25. Filter with `status` (comma separated) and `q` (text in
the title).

## Retries and idempotency {#retries}

Networks fail after the server has acted. To make a retry safe, send an `Idempotency-Key`
header with every `POST`: any unique string up to 255 characters, such as your own record id.

- The same key and the same body within 24 hours return the first response again, marked
  `Idempotent-Replayed: true`. Nothing is created twice.
- The same key with a different body is a `400 VALIDATION` error.
- While the first request is still running, a repeat gets `409 CONFLICT`. Wait and retry.
- Server errors (`5xx`) are not stored, so a retry with the same key runs again.

The Node.js client adds a key to every `POST` and retries network errors, timeouts, `429` and
`5xx` with exponential backoff. `PATCH` and `DELETE` are never retried automatically.

## Rate limits {#rate-limits}

Limits apply per API key when creating envelopes and templates, per signing token and client
address on the signing routes, per client address on public verification, and per recipient
for one-time codes. Over a limit the answer is
`429 RATE_LIMITED` with a `Retry-After` header in seconds. Wait that long, then retry.

On [sign.codevibe.in](https://sign.codevibe.in) the plan's counts apply as well, such as the
Free plan's 100 API requests a month. Past one the answer has the code `PLAN_LIMIT`, with
`details.limit`, `details.used` and `details.max`: `429` with `Retry-After` for the API request
counts, which start again by themselves, and `403` for the others. See
[Plans and pricing](/guides/pricing). A self-hosted server has no plan limits.

## Versioning {#versioning}

The version is in the path and covers the whole API: every route is under `/v1`, and every
answer carries `Codevibe-Api-Version: 1`. Within `v1`, changes only add: new routes, new
optional fields and new error codes may appear, so ignore fields you do not know and branch on
error `code`. [Versioning and deprecation](/http-api/versioning) lists exactly what counts as
a breaking change and the notice you get; [the changelog](/http-api/changelog) records every
change.

## Next

- [Errors](/http-api/errors)
- [Versioning and deprecation](/http-api/versioning)
