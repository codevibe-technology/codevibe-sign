---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-client': minor
'codevibe-sign': minor
---

**Breaking, before 1.0:** envelope and document JSON from the HTTP API no longer carries
`fileKey`, the path the server's file store keeps each original under. It was never an input
and gave callers nothing they could use; download a document through
`GET /v1/envelopes/:id/documents/:docId`. The OpenAPI document, the Postman collection and the
client's `Envelope` and `Document` types follow. Webhook payloads never had it. The server
exports `ApiEnvelope` and `ApiDocument` for the shape it answers with; core's own `Document`
type, used in-process, still has `fileKey`.
