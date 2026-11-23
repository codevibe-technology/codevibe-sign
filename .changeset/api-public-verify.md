---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-client': minor
---

Public verification of sealed PDFs: `POST /v1/verify` (upload) and `GET /v1/verify/{sha256}`
say whether a file is exactly what the server sealed, which check failed, and for a valid
file the envelope, signers and audit chain head its certificate page prints. No API key;
limited per client address (`limits.verifyPer10Minutes`), in size and in files checked at
once. `server.verifyPdf(bytes)` gives the same answer in process. The client gains
`verify.pdf`, `verify.sha256` and `createVerifyClient` for callers without a key.
