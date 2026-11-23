# Threat model

This document lists what Codevibe Sign protects, who it protects it from, and how. For each
threat it names the control, where the control lives, and what risk is left. It covers the
packages in this repository and the standalone server; an integrator who embeds the packages
takes on the server's duties listed here.

Status words used below:

- **Done**: implemented and tested in the named package.
- **Server** / **PDF** / **React**: the control belongs to that package; the requirement is stated
  here so it can be built and reviewed against it.
- **Operator**: a deployment duty. See [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md).

## Scope and trust boundaries

```
 sender's backend ──API key──▶ ┌──────────── server ────────────┐ ──HMAC webhook──▶ sender's backend
                               │ core (pure rules, no I/O)      │
 signer's browser ──token────▶ │ pdf  (parse, draw, seal)       │ ──SMTP / SMS───▶ recipients
   (react UI)      ──OTP─────▶ │ aadhaar (provider adapter)     │ ──HTTPS────────▶ eSign provider
                               └──────┬──────────────┬──────────┘ ◀──webhook──────
                                      │              │
                                  PostgreSQL     file store
```

- `@codevibe_technology/sign-core` holds the rules and never does I/O. Its functions are pure, so every
  guarantee it makes depends on the server persisting what it returns, atomically.
- The server is the only component that talks to the database, file store, mail and the network.
- The signer's browser, uploaded PDFs, signature images and every inbound webhook are untrusted.
- The database, file store and seal key are trusted for confidentiality by the operator, but the
  design assumes a database administrator may try to change records (see "Insider with database
  access").

## Assets

| Asset                       | Why it matters                                                     | Where it lives                                             |
| --------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| Documents (original, final) | Confidential business and personal data; the thing being agreed to | File store, keyed by `Document.fileKey`                    |
| Signatures and field values | Evidence of intent; personal data (handwriting, names)             | `Envelope.values`, drawn into the sealed PDF               |
| Audit trail                 | The evidence that ties a person to an action at a time             | Audit events table, `Envelope.auditHead`, PDF              |
| Signing links (tokens)      | Bearer credential to act as a recipient                            | Email/SMS in transit; only `tokenHash` is stored           |
| OTPs                        | Second factor for `email_otp` and `sms_otp` recipients             | Sent to the recipient; only a salted hash stored           |
| Seal key (PKCS#12)          | Lets anyone holding it produce "untampered" sealed files           | Server memory; operator's secret storage                   |
| API keys                    | Full control of envelopes for a tenant                             | Integrator's backend; server configuration                 |
| Outbound webhook secrets    | Let the integrator trust event callbacks                           | Server configuration and integrator's backend              |
| Provider tokens and salts   | Bill eSigns to the operator; verify provider callbacks             | `@codevibe_technology/sign-aadhaar` options, server config |
| Personal data in metadata   | Names, email, phone, IP, user agent                                | Envelope, audit events, certificate page, logs             |

## Actors

| Actor                         | Can do                                                                                | Wants to                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Sender (integrator, API key)  | Create, send and void envelopes; read their own envelopes and files                   | Get documents signed; may later want to dispute or alter what was signed |
| Signer / approver             | Open their link, authenticate, view, sign or decline when it is their turn            | Sign; may later want to deny signing or back-date it                     |
| Someone with a forwarded link | Whatever the link holder can do, until the link expires or is revoked                 | Sign in someone else's name, read the document                           |
| Network attacker              | Observe or change traffic that is not protected by TLS; replay captured requests      | Steal tokens, forge webhooks, read documents                             |
| Malicious PDF author          | Upload any bytes as a "PDF" (a sender, or anyone the server accepts uploads from)     | Crash or exhaust the server, run script in viewers, defeat the seal      |
| Malicious signature uploader  | Submit any string as a signature or initials value                                    | Exhaust memory when the image is decoded, inject content                 |
| Insider with database access  | Read and write any row; cannot read the seal key if it is stored outside the database | Change who signed, when, or what; delete a decline                       |

## Threats and controls

### 1. Signing links: forwarding, guessing and leakage

| Threat                                                        | Control                                                                                                                                                                                                                                                                                                                           | Where                                                        | Status                | Residual risk                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Guessing a valid link                                         | 32 random bytes (256 bits) from Web Crypto, base64url, 43 characters                                                                                                                                                                                                                                                              | `core/src/security.ts` `createSigningToken`                  | Done; property-tested | None in practice                                                                                                                            |
| Reading tokens from the database                              | Only `sha256(token)` is stored; `verifyToken` compares hashes in constant time                                                                                                                                                                                                                                                    | `core/src/security.ts`                                       | Done                  | A database reader can still act as nobody, but can see envelopes in full (see insider)                                                      |
| Oversized or junk tokens used to burn CPU                     | `verifyToken` refuses anything not shaped like an issued token before hashing                                                                                                                                                                                                                                                     | `core/src/security.ts`                                       | Done                  | None                                                                                                                                        |
| Link forwarded to someone else                                | `email_link` proves only control of the inbox. Envelopes that need more set `email_otp`, `sms_otp` or `aadhaar`                                                                                                                                                                                                                   | `core` `Recipient.auth`; `server/src/routes/signer.ts`       | Done                  | With `email_link`, a forwarded link is enough to sign. The certificate states the method used, so the evidence is honest about its strength |
| Forwarded link reading the document's details before the code | Until the one-time code is checked, `GET /v1/sign/:token` returns only what the invitation email already says: no message, documents, fields or values, and the email address masked                                                                                                                                              | `server/src/views.ts` `signerView`                           | Done; tested          | The title and the recipient's name are visible to the link holder, as they are in the email                                                 |
| Link valid forever                                            | Tokens expire (default: envelope expiry or 30 days, whichever is first), are single envelope, single recipient, and revoked when the recipient acts or the envelope reaches a final state                                                                                                                                         | `server/src/runtime/mutate.ts`, token table                  | Done                  | A link remains usable until expiry if the recipient's mailbox is compromised                                                                |
| Token in access logs and `Referer`                            | `GET /sign/:token` moves the token into an HttpOnly, SameSite=Strict cookie (Secure on https) and redirects with 303 to the signing page URL, which carries no token; the page calls `/v1/sign/link/...`. Every response sends `Referrer-Policy: no-referrer`. The server's logs replace the token segment and drop query strings | `server/src/routes/link.ts`, `server/src/http/redact.ts`     | Done                  | The proxy's own access logs still see `/sign/<token>` once; configure them to drop it (checklist)                                           |
| Acting on another envelope or recipient with a valid token    | Every request resolves the token to exactly one `(envelopeId, recipientId)`; the recipient id is never taken from the request body                                                                                                                                                                                                | `server/src/routes/signer.ts`                                | Done                  | None                                                                                                                                        |
| Fetching the signed copy after the link is spent              | A successful submit returns a receipt: HMAC over envelope, recipient and a 7-day expiry with the session secret, HttpOnly SameSite=Strict cookie on `/v1/sign` (or `X-Sign-Receipt`). It only reads status, a count of people still to act, and sealed files of that envelope; a session token is not accepted as a receipt       | `server/src/routes/receipt.ts`, `server/src/http/session.ts` | Done; tested          | Anyone holding the receipt within 7 days can download the signed copy, which the signer also receives by email                              |
| A dead link revealing more than the emails did                | A spent, expired or withdrawn link redirects with only the reason (`?state=`) and the workspace id (`&w=`), which the logo URL in every email already shows                                                                                                                                                                       | `server/src/routes/link.ts`                                  | Done; tested          |                                                                                                                                             |

### 2. OTP brute force and misuse

| Threat                                | Control                                                                                                                                                                                                                                                  | Where                                                      | Status                                                                                                | Residual risk                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guessing a code                       | 6 digits drawn by rejection sampling (no bias), 10 minutes, 5 wrong attempts then locked; the lock is permanent even for the right code                                                                                                                  | `core/src/security.ts` `createOtp`, `verifyOtp`            | Done; property-tested (attempts monotonic, at most +1 per check, lock permanent, at most one success) | 5 in 10⁶ per issued code                                                                                                                                        |
| Reissuing codes to reset the counter  | At most 5 codes per recipient per 15 minutes (`otpSendsPer15Minutes`) and 10 per recipient over the envelope's life (`otpCodesPerRecipient`, counted in the challenge row and kept until the envelope is final); each new code replaces the previous one | `server/src/routes/signer.ts`, `ServerStore.issueOtp`      | Done; tested                                                                                          | About 50 guesses per recipient per envelope in total, a 1 in 20 000 chance                                                                                      |
| Reusing an accepted code              | `verifyOtp` sets `usedAt`; a used code never verifies again                                                                                                                                                                                              | `core/src/security.ts`                                     | Done                                                                                                  | The server must persist the returned state on every call, success or failure                                                                                    |
| Concurrent guesses racing the counter | Each check is saved with a compare-and-set on the challenge's version (`ServerStore.updateOtp`) and re-read on a race, so parallel guesses each count                                                                                                    | `server/src/routes/signer.ts`, both stores                 | Done; tested (8 parallel guesses lock the code)                                                       | None                                                                                                                                                            |
| OTP readable from the database        | Only `sha256(salt:code)` with a random 16-byte salt is stored                                                                                                                                                                                            | `core/src/security.ts`                                     | Done                                                                                                  | Six digits are brute-forceable offline from the hash. Acceptable because the code lives 10 minutes and the database reader is already trusted with the envelope |
| Codes in logs or errors               | Errors carry only the attempts left; the code is never in a message or detail                                                                                                                                                                            | `core/src/security.ts`                                     | Done; property-tested                                                                                 | Server and SMS adapter must not log the outgoing message body                                                                                                   |
| Rate limits bypassed by IP rotation   | Limit per recipient first, per IP second; behind proxies the IP is the `X-Forwarded-For` entry `trustedProxyHops` from the right, never one the client wrote                                                                                             | `server/src/http/client.ts`, `server/src/routes/signer.ts` | Done                                                                                                  | Per-IP limits are weak against botnets; the per-recipient limit is the real control                                                                             |

### 3. Replay and double submission

| Threat                                          | Control                                                                                                                                                                         | Where                                        | Status                    | Residual risk                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Replaying a captured sign request               | A recipient who has acted can never act again (`INVALID_STATE`); TLS stops capture                                                                                              | `core/src/workflow.ts` `assertTurn`          | Done; property-tested     | None                                                                                                             |
| Replaying a decline or void                     | Final envelopes reject every transition; `tick` and `recordSeal` never change a final envelope                                                                                  | `core/src/workflow.ts`                       | Done; property-tested     | None                                                                                                             |
| Replaying an inbound provider webhook           | Leegality's `mac` covers only the document id and has no timestamp. The adapter confirms the reported status with the provider's status API before returning it (on by default) | `aadhaar/src/leegality/provider.ts`          | Done                      | A replay of a true event is still accepted; the server must apply events idempotently on `(providerRef, status)` |
| Replaying an outbound webhook to the integrator | Signature over `timestamp + "." + body` with a unique event id; receivers reject timestamps older than 5 minutes and ids already seen                                           | `server/src/runtime/webhooks.ts`; integrator | Done (server); integrator | Receivers that skip the checks are exposed                                                                       |

### 4. Races on concurrent submits

Two requests computed from the same envelope snapshot each produce a valid next state, and each
is missing the other's change. A store that saves the second one overwrites the first signer's
signature. The property test `workflow.property.test.ts` demonstrates this so the requirement is
visible.

| Control                                                                                                                                                                                                                 | Where                                                         | Status |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| `ServerStore.commit(envelope, events, expectedVersion, jobs)` saves the envelope, appends the events and enqueues jobs in one transaction, and fails if the version moved; the server always passes the version it read | `core/src/ports.ts` (contract), `server/src/store/*`          | Done   |
| On a version conflict, reload and re-run the transition (and draft edits) once more; the rules then reject or accept it on the new state                                                                                | `server/src/runtime/mutate.ts`, `server/src/routes/sender.ts` | Done   |
| Audit `seq` is unique per envelope: the primary key `(envelope_id, seq)` in PostgreSQL, and the memory store refuses a duplicate the same way                                                                           | `server/src/store/migrations.ts`, `memory.ts`                 | Done   |

Residual risk: none if the store honours `expectedVersion`. A store that ignores it loses
signatures silently.

### 5. Audit trail tampering by a database administrator

The chain is `hash = sha256(prevHash + canonicalize(event))` from a genesis value of 64 zeros
(`core/src/audit.ts`). `canonicalize` sorts keys at every level and drops `undefined`; the
property tests check it is stable under key order, a fixed point under re-parsing, and keeps
every key (a `__proto__` key used to vanish; fixed).

**What the chain detects**, given the expected head and envelope id
(`verifyChain(events, hasher, { expectedHead, envelopeId })`):

- any change to any field of any event, including context and data;
- removing, duplicating or reordering events, and changing `seq`, `prevHash` or `hash`;
- events cut off the end (only with `expectedHead`; without it, a truncated chain still verifies);
- events from another envelope mixed in, or a whole log from another envelope (only with
  `envelopeId`).

All of these are covered by property tests in `audit.property.test.ts`.

**What it does not prove on its own**:

- Someone with write access can rebuild the whole chain from changed events. The rebuilt chain
  verifies by itself; it fails only against a head stored somewhere the attacker cannot change.
  `Envelope.auditHead` lives in the same database, so it does not help against a database
  administrator. Anchors outside the database do:
  - the head printed on the certificate page and covered by the seal, which every recipient
    receives by email (`completed_copy`);
  - the `document.sealed` event's SHA-256 of the sealed file;
  - optionally, the operator publishing or timestamping heads elsewhere (an RFC 3161 time-stamp
    authority, a write-once bucket, or a log the DBA cannot write).
- The chain says nothing about events that were never written. A server that skipped recording a
  `recipient.viewed` event leaves no trace.
- `at`, `ip` and `userAgent` are what the server observed. The chain proves they were not changed
  after writing, not that they were true. Behind a proxy, the IP is only as good as the proxy's
  `X-Forwarded-For` handling (see the checklist).
- Without options, `verifyChain` takes the envelope id from the first event, so a whole chain
  copied from another envelope would pass. Pass `{ envelopeId }` with the id of the envelope
  being verified (alongside `expectedHead`) to rule that out. The server does both on
  `/events` and `/certificate`.

Residual risk: before an envelope completes, a DBA can rewrite its history undetectably, because
no copy of the head has left the database yet. Mitigation for high-value use: timestamp heads
externally at each transition.

### 6. PDF-based attacks

| Threat                                                                                              | Control                                                                                                                                                                                                                                                                                                                                                              | Where                                            | Status       | Residual risk                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Huge uploads                                                                                        | Request body cap at the proxy and the server (default 25 MB); `loadPdf` refuses larger files                                                                                                                                                                                                                                                                         | Server, `pdf/src/inspect.ts`                     | Done         |                                                                                                                                                  |
| Decompression bombs, deep or cyclic object graphs, huge page counts                                 | `inspectPdf` and `verify` read the file first in a worker thread with a 512 MB heap: every Flate stream is inflated against a shared 50 MB budget before pdf-lib sees it, then max pages (500), max objects (100 000), max nesting depth of objects and page tree (64) and page-tree cycles are checked; the worker is terminated after 10 s. All limits are options | `pdf/src/limits.ts`, `limits-worker.ts`          | Done; tested | `renderFields`, `appendCertificate` and `seal` parse on the calling thread; give them only files that passed `inspectPdf`, as the server does    |
| JavaScript, launch actions, embedded files, forms that change on open                               | `renderFields` copies the pages into a fresh document, dropping `/OpenAction`, `/AA`, `/JavaScript`, `/EmbeddedFiles`, launch, URI and all other actions except in-document links, file attachment and media annotations and XFA; form fields are flattened first                                                                                                    | `pdf/src/sanitize.ts`                            | Done; tested | The original upload still contains them; serve it only as a download with `Content-Disposition: attachment` and never inline from the app origin |
| Encrypted PDFs                                                                                      | Refused                                                                                                                                                                                                                                                                                                                                                              | `pdf/src/inspect.ts`                             | Done         |                                                                                                                                                  |
| Content that differs by viewer (shadow attacks: hidden layers, overlays, conflicting xref sections) | Render what is signed from the parsed document into a freshly written file that holds only the objects its pages use (no incremental update of the upload), then seal that; show the signer the same rendering                                                                                                                                                       | `pdf/src/sanitize.ts`, `render.ts`, React        | Done (PDF)   | A signer viewing in a different viewer could see different content in the original; the sealed output is what counts                             |
| Incremental update after sealing                                                                    | `verify()` is valid only when there is exactly one signature, it covers every byte, and its `/ByteRange` brackets the `/Contents` of the signature field the form declares                                                                                                                                                                                           | `pdf/src/trust.ts`, `verify.ts`                  | Done; tested | Callers who use `verifySeal` and check only `valid` miss appended changes                                                                        |
| Fake `/ByteRange` text earlier in the file                                                          | The signature is located through the parsed AcroForm `/Sig` field, not a text search                                                                                                                                                                                                                                                                                 | `pdf/src/signatures.ts`                          | Done; tested |                                                                                                                                                  |
| Any self-signed certificate passing as a seal                                                       | `verify(bytes, { trust })` compares the signer certificate with the operator's (SHA-256 fingerprint or certificate) or chains it to a configured root; the server checks every sealed file against its own certificate before storing it and at `GET /v1/envelopes/:id/documents/:docId/verification`                                                                | `pdf/src/trust.ts`, `server/src/runtime/seal.ts` | Done; tested | `verifySeal` alone still accepts any key; it is documented as the low-level check                                                                |

### 7. Image bombs and hostile signature uploads

| Threat                                      | Control                                                                                                                                                                                                                                                                                                                     | Where                                      | Status                | Residual risk                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------- | ---------------------------------------------------------------------------- |
| Oversized image                             | 512 KB cap, checked on the base64 length before decoding and again after                                                                                                                                                                                                                                                    | `core/src/validation.ts` `normalizePng`    | Done; property-tested |                                                                              |
| Tiny PNG declaring a giant canvas           | Declared width and height must be at most 2048 pixels (`MAX_IMAGE_DIMENSION`), checked again when the image is re-encoded                                                                                                                                                                                                   | `core/src/validation.ts`, `pdf/src/png.ts` | Done; property-tested |                                                                              |
| SVG, HTML or other types sent as "images"   | Only real PNG signature + IHDR is accepted; other `data:` types fail                                                                                                                                                                                                                                                        | `core/src/validation.ts`                   | Done; property-tested |                                                                              |
| Malformed PNG chunks exploiting the decoder | Every signature image is re-encoded before it is drawn: chunk CRCs, header values and scanline filters are checked, the pixel data must inflate to exactly the size the header implies (inflation is capped at that size), and only the header, palette, transparency and freshly compressed pixels reach pdf-lib's decoder | `pdf/src/png.ts`                           | Done; tested          | pdf-lib still decodes the clean PNG, at a cost bounded by 2048 × 2048 pixels |

### 8. Webhooks

| Threat                                        | Control                                                                                                           | Where                                             | Status       | Residual risk                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofed provider webhook                      | HMAC check (constant-time) plus confirmation through the provider's status API; optional static header            | `aadhaar/src/leegality/webhook.ts`, `provider.ts` | Done         | With `confirmWebhooks: false`, anyone who has seen one valid callback for a document can forge any status for it, because the mac covers only the document id |
| Oversized webhook body                        | Refused over 256 KB before parsing                                                                                | `aadhaar/src/leegality/webhook.ts`                | Done (new)   | The server should also cap the route's body size                                                                                                              |
| Spoofed outbound webhook (to the integrator)  | HMAC-SHA256 over `timestamp.body` with a per-endpoint secret, sent in a header with the timestamp and an event id | `server/src/runtime/webhooks.ts`                  | Done         |                                                                                                                                                               |
| SSRF through integrator-supplied webhook URLs | See the rules below                                                                                               | `server/src/runtime/webhook-guard.ts`             | Done; tested | A custom `fetch` keeps the checks but cannot pin the connection                                                                                               |

Webhook URL rules for the server, implemented in `server/src/runtime/webhook-guard.ts`
(applied at start-up and again at every delivery, after DNS resolution, because DNS can
change):

1. `https` only. Plain `http` only when the operator sets `webhookSecurity.allowInsecure`.
2. Resolve the host and refuse loopback, private, link-local, CGNAT, multicast and reserved
   ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`
   (cloud metadata), `100.64.0.0/10`, `0.0.0.0/8`, `224.0.0.0/4`, `240.0.0.0/4`, `::1`, `fc00::/7`,
   `fe80::/10`, `::ffff:0:0/96` mapped forms of the above, and `64:ff9b::/96`.
3. Connect to the address that was checked (pin it), so a second DNS answer cannot redirect the
   request.
4. Do not follow redirects.
5. Refuse URLs with credentials, non-default ports below 1024 other than 443, and hosts that are
   bare IP addresses unless the operator allow-lists them.
6. Short timeouts (connect 5 s, total 10 s), a small response cap (64 KB, then discard), and never
   return the response body or connection error details to the API caller.
7. Optional operator allow-list of host suffixes; when set, it is the only check that matters.

### 9. Timing attacks

| Comparison                             | Control                                                                                                                                                                       | Where                              | Status |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| Signing token vs stored hash           | Constant-time compare of hashes                                                                                                                                               | `core/src/security.ts`             | Done   |
| OTP vs stored hash                     | Constant-time compare; malformed input hashed the same way                                                                                                                    | `core/src/security.ts`             | Done   |
| Provider webhook mac and static header | `crypto.timingSafeEqual` on equal-length buffers                                                                                                                              | `aadhaar/src/leegality/webhook.ts` | Done   |
| API keys                               | Stored as `sha256(key)` (plain keys are hashed at start-up, or configured as hashes), presented keys hashed and compared with `timingSafeEqual` against every configured hash | `server/src/http/auth.ts`          | Done   |
| Token lookup                           | Look up by `tokenHash`, never by the raw token or a prefix of it; malformed tokens are refused before hashing                                                                 | `server/src/routes/signer.ts`      | Done   |

Residual risk: length differences leak, which is harmless for fixed-length hashes.

### 10. Log and error leakage

| Rule                                                                                                                                                                                                  | Where                                       | Status                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------ |
| Errors from core and aadhaar carry codes and safe details only, never tokens, codes, credentials or document bytes                                                                                    | core, aadhaar (tested)                      | Done                     |
| No package in this repository logs                                                                                                                                                                    | All packages                                | Done                     |
| The server logs envelope ids and error codes, not bodies, query strings, `Authorization`, cookies, tokens, OTPs, signature images or document names: every log line passes through a redacting logger | `server/src/http/redact.ts`                 | Done; tested             |
| Access logs strip the query string and path segment that carries a signing token                                                                                                                      | `server/src/server.ts` (`accessLog`), proxy | Done (server) / Operator |
| Configuration errors name variables, never their values                                                                                                                                               | `apps/server/src/config.ts`                 | Done                     |
| Provider error messages are passed through as text; they never contain our credentials but may name the document                                                                                      | aadhaar                                     | Done                     |

### 11. Seal key (PKCS#12)

| Threat                                 | Control                                                                                                                                                                                                                                 | Where                                             | Status                        | Residual risk                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key theft from the image or repository | The key is supplied at run time (`SEAL_P12_BASE64`, `SEAL_P12_PASSPHRASE`), never baked into the image                                                                                                                                  | `apps/server`                                     | Done                          | Environment variables are visible to anyone who can inspect the container; prefer a mounted secret file or a KMS                                        |
| Key in memory dumps or logs            | Decode once at start-up, keep only the parsed key object, never log or return it, wipe the base64 buffer after parsing                                                                                                                  | Server, PDF                                       | Server                        |                                                                                                                                                         |
| Weak key                               | Require RSA ≥ 2048 and a certificate signed with SHA-256 or stronger, valid at the signing time; `seal()` refuses otherwise, and the server opens the key at start-up and refuses to start. `allowWeakKey` exists for local development | `pdf/src/cms.ts`, `server/src/runtime/context.ts` | Done; tested                  | ECDSA keys are not supported yet                                                                                                                        |
| Compromised key                        | Rotation: new certificate, restart; files sealed earlier keep verifying against the old certificate, which the operator must keep (public part) for verification                                                                        | Operator                                          | Operator                      | A stolen key can seal forged files that pass `verify()` until the operator revokes the certificate; external timestamps on audit heads limit the damage |
| Signer's intent attributed to the seal | The seal proves the file has not changed since sealing; intent is proven by the audit trail. The certificate page says so                                                                                                               | Docs, PDF                                         | Done (`docs/ARCHITECTURE.md`) |                                                                                                                                                         |

### 12. Public verification and templates

`POST /v1/verify` and `GET /v1/verify/:sha256` take no credential, so they are written for a
hostile caller. Templates are sender routes and follow the envelope rules.

| Threat                                                                                 | Control                                                                                                                                                                                                                                                                                             | Where                                                                | Residual risk                                                                                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Learning about an envelope without holding its sealed file                             | The envelope is named only for a file whose seal verifies against this server's certificate, or for the exact SHA-256 of a sealed file. The lookup matches `document.sealed` events only, so the hash of an original cannot be probed, and the stored file is hashed again before it is vouched for | `server/src/verification.ts`, `store/*.ts` `findSealed`              | Whoever holds the sealed file, or its hash, sees what its certificate page prints. A hash is as good as the file for this; treat it so      |
| Personal data in the answer                                                            | Names, masked contacts, role, status, sign-in method, event names and times, chain head. No address in full, IP, browser, workspace, metadata or storage path                                                                                                                                       | `verification.ts` `envelopeOf`                                       | Less than the certificate page in the file, which prints IP and browser                                                                     |
| Using the route to burn CPU or memory                                                  | Counted per client address (IPv4 address or IPv6 /64) before the body is read; 30 per 10 minutes by default. Body capped at `maxPdfBytes`; the parse runs under the worker limits of section 6; at most 4 files are checked at once, others get `429`                                               | `routes/verify.ts`, `server.ts`, `verification.ts`                   | Without `trustProxy` behind a proxy, every caller shares one allowance of 300 per 10 minutes, so one client can use it up; set `trustProxy` |
| Writing through a public route                                                         | The routes only read the store and the file store; nothing is queued, mailed or logged about the file                                                                                                                                                                                               | `verification.ts`                                                    | None                                                                                                                                        |
| Reaching another workspace's template                                                  | Every store call takes the caller's workspace; another workspace's id answers the same `NOT_FOUND` as one that does not exist. File keys are built from server-made ids, never from the request                                                                                                     | `routes/templates.ts`, `store/*.ts`, `template.ts` `templateFileKey` | None                                                                                                                                        |
| Error text that grows with attacker input                                              | Paths in a validation error are rewritten in one pass, so a role named like a path cannot make the message multiply                                                                                                                                                                                 | `routes/templates.ts` `repoint`                                      | None                                                                                                                                        |
| A key that mints keys                                                                  | The API has no route for API keys; they are made and revoked in the dashboard behind a session                                                                                                                                                                                                      | by design                                                            | None                                                                                                                                        |
| Guards in front of the API that read the address differently from the router (web app) | The plan gate and the role checks decode the path the way the router does, and refuse one that cannot be decoded                                                                                                                                                                                    | `apps/web/src/server/sign/route-path.ts`                             | None                                                                                                                                        |

### 13. Other notes

- **Back-dated `date_signed` values.** Core ignores any value a signer submits for a
  `date_signed` field and stores the server's time of signing instead, as a full ISO date-time
  in UTC taken from the same clock as the `recipient.signed` audit event. The drawn date is
  formatted from that value (in the signer's time zone when the server passes one), and the
  certificate page shows the exact UTC time of every event, so the two can always be compared.
- **Dates on the signed document.** The date drawn in a `date_signed` field and under each
  signature is the server's time of signing in the workspace's time zone: the one
  `workspaceTimeZone` returns (the "Time zone" setting of a workspace in the web app), else
  `timeZone` (`TIME_ZONE`, `SIGN_TIME_ZONE` in the web app), else UTC. The certificate page
  always shows UTC and adds that zone's time next to it, so the printed date can be checked
  against the exact moment. Changing the setting affects documents sealed afterwards only; a
  sealed file never changes. The zone comes from the workspace, never from the signer's
  browser, so a signer cannot pick the date that is printed. On screen the web app shows every
  time in the reader's own zone and names the zone.
- **The web app's browser policy.** `apps/web` sends a Content-Security-Policy that loads
  scripts, styles, images and connections from its own origin only and forbids framing, and
  `Referrer-Policy: no-referrer` on the signing link, page and API (`src/lib/security-headers.ts`).
  Inline scripts and styles stay allowed because Next.js needs them, so the policy limits where
  injected markup could load code from or send data to; it does not replace output encoding.
- **Sign-in links.** The web app sends one address at most five sign-in links in fifteen
  minutes, so the form cannot be used to flood an inbox (`src/server/auth/magic-link-limit.ts`).
  The count is kept in memory per process.
- **Passwords for senders.** People who send documents may sign in to the web app with an
  email and password instead of an emailed link. Signers are not affected: they keep the
  personal link and one-time code.
  - _Where accounts come from._ There is no open registration with a password. An account
    starts from an emailed sign-in link, or from an invitation, where a new person chooses a
    password on the invitation page; in both cases holding the emailed link confirms the
    address first. An invitation never sets a password on an account that already exists
    (`createInvitedAccount`), so it cannot be used to take one over.
  - _Storage._ Better Auth hashes passwords with scrypt (N 16384, r 16, p 1, a random salt per
    password) and compares in constant time. Only the hash is stored, in `auth_accounts`.
  - _Rules._ 10 to 128 characters, no composition rules. Passwords built from common words
    however decorated (`P@ssw0rd123`, `Welcome@2026`), keyboard runs, repeats and the account's
    own email or name are refused (`src/lib/password.ts`). The list is local: no password or
    hash leaves the server. A breach-corpus check (for example Have I Been Pwned's range API)
    is not wired in.
  - _Guessing._ After five wrong passwords for one address in fifteen minutes, password
    sign-in pauses for that address until the window ends, whatever IP the tries come from
    (`password-lockout.ts`); wrong "current password" entries in settings count too. The
    library also limits sign-in requests per IP (three in ten seconds). The emailed link keeps
    working during a pause, so pausing someone's password does not lock them out. Counts are
    in memory per process, like the other limits.
  - _Enumeration._ A wrong password, an account with no password and an unknown address get
    the same answer after the same hashing work. "Forgot password" answers the same for any
    address, and over its cap of five emails per address in fifteen minutes it drops the
    email silently rather than answer differently.
  - _Reset links._ Valid for 30 minutes, usable once, sent only to the account's address.
    Using one signs every session of the account out. The reset and invitation pages send no
    referrer. Someone who can read the mailbox can take the account, as with sign-in links.
  - _Stolen session._ A session can set a first password without proving anything more, since
    there is no old password to ask for; changing an existing one needs the current password.
    Every set, change or reset emails the account's address, and settings can sign every
    other session out.
- **Viewers and the completed copy.** Every recipient, including viewers, is sent the completed
  copy. Senders should treat the recipient list as the distribution list.
- **Provider signing links.** The Aadhaar adapter refuses a signing link that is not `https`, so a
  tampered provider response cannot send a signer to a `javascript:` or `http:` URL.
- **Provider responses.** Signed files and JSON from the provider are read with a streaming cap,
  so a missing or false `Content-Length` cannot make the server buffer without limit.
