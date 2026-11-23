---
title: Versioning and deprecation
description: How the Codevibe Sign HTTP API is versioned as one unit, exactly which changes count as breaking, and how much notice you get before anything is removed.
---

# Versioning and deprecation

The API is versioned as one unit, and the version is in the path. Every route is under `/v1`,
and every answer carries the header `Codevibe-Api-Version: 1`. You never mix versions: a
client talks to `/v1` for everything, or to a later version for everything.

```http
GET /api/v1/envelopes HTTP/1.1
Authorization: Bearer cvs_...

HTTP/1.1 200 OK
Codevibe-Api-Version: 1
```

Two addresses are outside the versioned API on purpose, and stay the same for good:
`GET /health`, a probe for load balancers, and `GET /sign/<token>`, the address printed in
every signing email.

## What can change within version 1

Only additions that an existing client can ignore. They ship without notice and are recorded
in the [changelog](/http-api/changelog):

- a new route;
- a new optional request field, query parameter or header;
- a new field in a response or in a webhook body;
- a new webhook event type;
- a new value in a list that the reference marks as one that may grow, such as an error code,
  an audit action or a verification `reason`;
- a higher limit, or a limit you can now configure.

Write clients to match:

- ignore response fields and webhook event types you do not know;
- branch on the error `code`, never on the `message`, and treat an unknown code by its HTTP
  status;
- treat ids and cursors as opaque strings, with no fixed length or format.

## What counts as a breaking change

Any of these needs a new version. None of them will happen within `/v1`:

- removing or renaming a route, a request field, a response field or a webhook field;
- changing the type or the meaning of a field, or of a status code a route answers with;
- making an optional request field required, or adding a required one;
- removing a value from a list of values, or changing what an existing value means;
- changing the HTTP status that goes with an error code;
- tightening validation so that a request accepted today is refused;
- lowering a documented default limit;
- changing how requests are authenticated, or how webhooks are signed;
- changing the default of a setting in a way that changes what an unchanged request does.

Fixing a security flaw is the one exception. If a flaw can only be closed by changing
behaviour, it is closed at once, announced in the changelog and by email, and kept as narrow
as it can be.

## When a breaking change is needed

A whole new version is published next to the old one: `/v2` with every route in it, not a
second version of one endpoint. Routes that did not change answer from the same code in both
versions, so they behave the same. You move by changing the base URL once, after reading the
list of differences.

- `/v1` keeps working for at least **12 months** after `/v2` is generally available.
- Both versions use the same API keys, envelopes and webhooks.

## Deprecation

Nothing is deprecated today. When an operation, a field or a whole version is going away:

1. It is announced at least **6 months** before it stops working: in the
   [changelog](/http-api/changelog), by email to the owners of every workspace that has API
   keys, and in the API's own answers.
2. The operation is marked `deprecated` in the [OpenAPI document](/openapi.json), with the
   date it was marked and the date it stops working.
3. From that day, every answer of the operation carries three headers:

```http
Deprecation: @1798761600
Sunset: Fri, 02 Jul 2027 00:00:00 GMT
Link: <https://sign.codevibe.in/docs/http-api/versioning>; rel="deprecation"; type="text/html"
```

`Deprecation` ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)) is the moment the operation
was marked, in seconds since 1970. `Sunset` ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594))
is the moment it stops working. Until then it works exactly as before. Log these headers in
your client and you will hear about a deprecation even if nobody reads the email.

After the sunset date the operation answers `404 NOT_FOUND`.

## Self-hosted servers

A server you run yourself changes only when you upgrade it. The same rules apply to the
packages: a release that breaks the HTTP API is a new major version of
`@codevibe_technology/sign-server`, and its own `GET /v1/openapi.json` always describes
exactly what that server answers.

## Next

[API changelog](/http-api/changelog)
