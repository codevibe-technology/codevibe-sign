---
title: HTTP API
description: The Codevibe Sign HTTP API - send documents for signature, follow them with webhooks and download the sealed PDF - with a quickstart, a full reference and a local sandbox.
---

# HTTP API

The Codevibe Sign API sends documents for signature from your backend. It takes and returns
JSON, uses ordinary HTTP status codes, and is described end to end by an OpenAPI 3.1 document,
so the reference, the examples and the [Postman collection](/codevibe-sign.postman_collection.json)
all come from one place.

<div class="api-base">
<p><span class="api-base__label">Cloud</span><code>https://sign.codevibe.in/api</code></p>
<p><span class="api-base__label">Self-hosted</span><code>https://&lt;your server&gt;</code></p>
</div>

The cloud and a self-hosted server answer the same routes. The examples use the cloud address;
put your own server's address in its place when you run Codevibe Sign yourself.

## Start here

- [**Quickstart**](/http-api/quickstart): get a key and send your first envelope in five minutes.
- [**Authentication**](/http-api/authentication): API keys for your backend, signing tokens for
  the people who sign.
- [**API reference**](/http-api/reference): every route, with parameters, errors and examples in
  curl, Node.js, Python and Go.
- [**Webhooks**](/http-api/reference/webhooks): events posted to your backend, and how to verify
  them.
- [**Errors**](/http-api/errors): every error code and what to do about it.
- [**Versioning and deprecation**](/http-api/versioning): what can change, what never will, and
  the notice you get.
- [**Local sandbox**](/http-api/sandbox): a throwaway server on your machine for trying requests.

## How the API is shaped

An **envelope** is one signing job: the PDFs, the **recipients** who sign, approve or receive a
copy, and the **fields** they fill in. You create it and send it, and the server does the rest:
it emails each recipient in turn, checks one-time codes, records every step in a hash-chained
audit trail and seals the finished PDF with a digital signature. A **template** keeps the PDFs,
roles and fields of an envelope you send often, so each new one only needs the people.

Two kinds of caller use the API:

| Caller                   | Authenticates with                          | Routes                                 |
| ------------------------ | ------------------------------------------- | -------------------------------------- |
| Your backend             | An API key in `Authorization: Bearer <key>` | `/v1/envelopes...`, `/v1/templates...` |
| The signer's browser     | The signing token from their link           | `/v1/sign/...`                         |
| Anyone with a sealed PDF | Nothing: verification is public             | `/v1/verify...`                        |

Keep API keys on your server. Only the signing routes are meant for browsers, and only from
the signing page on your own origin. The server sends no CORS headers, which is the safe
default for an API that takes secret keys.

## Downloads

- [`openapi.json`](/openapi.json): the OpenAPI 3.1 document. Every server also serves its own
  copy at `GET /v1/openapi.json`. Generate clients from it, or import it into Insomnia.
- [Postman collection](/codevibe-sign.postman_collection.json): set `baseUrl` and `apiKey` and run
  the requests in order. Creating an envelope fills in `envelopeId` and `docId` for the rest.
- [`@codevibe_technology/sign-client`](https://www.npmjs.com/package/@codevibe_technology/sign-client):
  the typed TypeScript client used in the Node.js examples.
