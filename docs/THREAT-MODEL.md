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

- `@codevibe/sign-core` holds the rules and never does I/O. Its functions are pure, so every
  guarantee it makes depends on the server persisting what it returns, atomically.
- The server is the only component that talks to the database, file store, mail and the network.
- The signer's browser, uploaded PDFs, signature images and every inbound webhook are untrusted.
- The database, file store and seal key are trusted for confidentiality by the operator, but the
  design assumes a database administrator may try to change records (see "Insider with database
  access").

## Assets

| Asset                       | Why it matters                                                     | Where it lives                                   |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Documents (original, final) | Confidential business and personal data; the thing being agreed to | File store, keyed by `Document.fileKey`          |
| Signatures and field values | Evidence of intent; personal data (handwriting, names)             | `Envelope.values`, drawn into the sealed PDF     |
| Audit trail                 | The evidence that ties a person to an action at a time             | Audit events table, `Envelope.auditHead`, PDF    |
| Signing links (tokens)      | Bearer credential to act as a recipient                            | Email/SMS in transit; only `tokenHash` is stored |
| OTPs                        | Second factor for `email_otp` and `sms_otp` recipients             | Sent to the recipient; only a salted hash stored |
| Seal key (PKCS#12)          | Lets anyone holding it produce "untampered" sealed files           | Server memory; operator's secret storage         |
| API keys                    | Full control of envelopes for a tenant                             | Integrator's backend; server configuration       |
| Outbound webhook secrets    | Let the integrator trust event callbacks                           | Server configuration and integrator's backend    |
| Provider tokens and salts   | Bill eSigns to the operator; verify provider callbacks             | `@codevibe/sign-aadhaar` options, server config  |
| Personal data in metadata   | Names, email, phone, IP, user agent                                | Envelope, audit events, certificate page, logs   |

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

| Threat                                                     | Control                                                                                                                                                                                                               | Where                                       | Status                | Residual risk                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Guessing a valid link                                      | 32 random bytes (256 bits) from Web Crypto, base64url, 43 characters                                                                                                                                                  | `core/src/security.ts` `createSigningToken` | Done; property-tested | None in practice                                                                                                                            |
| Reading tokens from the database                           | Only `sha256(token)` is stored; `verifyToken` compares hashes in constant time                                                                                                                                        | `core/src/security.ts`                      | Done                  | A database reader can still act as nobody, but can see envelopes in full (see insider)                                                      |
| Oversized or junk tokens used to burn CPU                  | `verifyToken` refuses anything not shaped like an issued token before hashing                                                                                                                                         | `core/src/security.ts`                      | Done                  | None                                                                                                                                        |
| Link forwarded to someone else                             | `email_link` proves only control of the inbox. Envelopes that need more set `email_otp`, `sms_otp` or `aadhaar`                                                                                                       | `core` `Recipient.auth`; server enforces    | Server                | With `email_link`, a forwarded link is enough to sign. The certificate states the method used, so the evidence is honest about its strength |
| Link valid forever                                         | Tokens expire (default: envelope expiry or 30 days, whichever is first), are single envelope, single recipient, and revoked when the envelope reaches a final state or the recipient is re-sent                       | Server token table                          | Server                | A link remains usable until expiry if the recipient's mailbox is compromised                                                                |
| Token in access logs and `Referer`                         | The server exchanges the token on first request for an HttpOnly, Secure, SameSite=Strict session cookie bound to that recipient, then redirects to a URL without the token; pages send `Referrer-Policy: no-referrer` | Server, React                               | Server                | Mail scanners that pre-fetch links see the token; the exchange must be idempotent and must not mark the recipient as viewed on a GET        |
| Acting on another envelope or recipient with a valid token | Every request resolves the token to exactly one `(envelopeId, recipientId)`; the recipient id is never taken from the request body                                                                                    | Server                                      | Server                | None if followed                                                                                                                            |

### 2. OTP brute force and misuse

| Threat                                | Control                                                                                                                                 | Where                                           | Status                                                                                                | Residual risk                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guessing a code                       | 6 digits drawn by rejection sampling (no bias), 10 minutes, 5 wrong attempts then locked; the lock is permanent even for the right code | `core/src/security.ts` `createOtp`, `verifyOtp` | Done; property-tested (attempts monotonic, at most +1 per check, lock permanent, at most one success) | 5 in 10⁶ per issued code                                                                                                                                        |
| Reissuing codes to reset the counter  | Cap issuance: at most 5 codes per recipient per hour and 10 per envelope in total; each reissue invalidates the previous code           | Server                                          | Server                                                                                                | Without the cap, guessing becomes a matter of patience: about 200 000 issued codes per expected success                                                         |
| Reusing an accepted code              | `verifyOtp` sets `usedAt`; a used code never verifies again                                                                             | `core/src/security.ts`                          | Done                                                                                                  | The server must persist the returned state on every call, success or failure                                                                                    |
| Concurrent guesses racing the counter | Verify and persist in one transaction with a row lock or version check, so two parallel guesses cannot both read `attempts = 4`         | Server                                          | Server                                                                                                | Without it, an attacker gains a few extra guesses per code                                                                                                      |
| OTP readable from the database        | Only `sha256(salt:code)` with a random 16-byte salt is stored                                                                           | `core/src/security.ts`                          | Done                                                                                                  | Six digits are brute-forceable offline from the hash. Acceptable because the code lives 10 minutes and the database reader is already trusted with the envelope |
| Codes in logs or errors               | Errors carry only the attempts left; the code is never in a message or detail                                                           | `core/src/security.ts`                          | Done; property-tested                                                                                 | Server and SMS adapter must not log the outgoing message body                                                                                                   |
| Rate limits bypassed by IP rotation   | Limit per recipient first, per IP second                                                                                                | Server                                          | Server                                                                                                | Per-IP limits are weak against botnets; the per-recipient limit is the real control                                                                             |

### 3. Replay and double submission

| Threat                                          | Control                                                                                                                                                                         | Where                               | Status                | Residual risk                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Replaying a captured sign request               | A recipient who has acted can never act again (`INVALID_STATE`); TLS stops capture                                                                                              | `core/src/workflow.ts` `assertTurn` | Done; property-tested | None                                                                                                             |
| Replaying a decline or void                     | Final envelopes reject every transition; `tick` and `recordSeal` never change a final envelope                                                                                  | `core/src/workflow.ts`              | Done; property-tested | None                                                                                                             |
| Replaying an inbound provider webhook           | Leegality's `mac` covers only the document id and has no timestamp. The adapter confirms the reported status with the provider's status API before returning it (on by default) | `aadhaar/src/leegality/provider.ts` | Done                  | A replay of a true event is still accepted; the server must apply events idempotently on `(providerRef, status)` |
| Replaying an outbound webhook to the integrator | Signature over `timestamp + "." + body` with a unique event id; receivers reject timestamps older than 5 minutes and ids already seen                                           | Server; integrator                  | Server                | Receivers that skip the checks are exposed                                                                       |

### 4. Races on concurrent submits

Two requests computed from the same envelope snapshot each produce a valid next state, and each
is missing the other's change. A store that saves the second one overwrites the first signer's
signature. The property test `workflow.property.test.ts` demonstrates this so the requirement is
visible.

| Control                                                                                                                                             | Where                                        | Status |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| `EnvelopeStore.save(envelope, events, expectedVersion)` saves the envelope and appends the events in one transaction and fails if the version moved | `core/src/ports.ts` (contract), server store | Server |
| On a version conflict, reload and re-run the transition once; the rules then reject or accept it on the new state                                   | Server                                       | Server |
| Audit `seq` has a unique index per envelope, so two writers can never both append event N                                                           | Server schema                                | Server |

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
  being verified (alongside `expectedHead`) to rule that out.

Residual risk: before an envelope completes, a DBA can rewrite its history undetectably, because
no copy of the head has left the database yet. Mitigation for high-value use: timestamp heads
externally at each transition.

### 6. PDF-based attacks

| Threat                                                                                              | Control                                                                                                                                                                                                               | Where                        | Status       | Residual risk                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Huge uploads                                                                                        | Request body cap at the proxy and the server (default 25 MB); `loadPdf` refuses larger files                                                                                                                          | Server, `pdf/src/inspect.ts` | PDF / Server |                                                                                                                                                  |
| Decompression bombs, deep or cyclic object graphs, huge page counts                                 | Parse with limits: max pages (500), max objects (100 000), max nesting depth (64), max decoded stream size (50 MB), wall-clock limit (10 s), in a worker thread that can be killed                                    | PDF, Server                  | PDF / Server | pdf-lib has no built-in limits; without a worker, one bad file can block the event loop                                                          |
| JavaScript, launch actions, embedded files, forms that change on open                               | Drop `/OpenAction`, `/AA`, `/JavaScript`, `/Names /EmbeddedFiles`, `/Launch`, `/URI` actions and XFA when producing the final document; flatten form fields                                                           | PDF                          | PDF          | The original upload still contains them; serve it only as a download with `Content-Disposition: attachment` and never inline from the app origin |
| Encrypted PDFs                                                                                      | Refused                                                                                                                                                                                                               | `pdf/src/inspect.ts`         | PDF          |                                                                                                                                                  |
| Content that differs by viewer (shadow attacks: hidden layers, overlays, conflicting xref sections) | Render what is signed from the parsed document, then seal a freshly written, fully rewritten file (no incremental update of the upload); show the signer the same rendering                                           | PDF, React                   | PDF          | A signer viewing in a different viewer could see different content in the original; the sealed output is what counts                             |
| Incremental update after sealing                                                                    | `verifySeal` reports `coversWholeDocument`; `verify()` must report valid only when the signature covers every byte, there is exactly one signature, and its `/ByteRange` is the one referenced by the signature field | PDF                          | PDF          | Callers who check only `valid` miss appended changes                                                                                             |
| Fake `/ByteRange` text earlier in the file                                                          | Locate the signature through the parsed AcroForm `/Sig` field, not a text search                                                                                                                                      | PDF                          | PDF          |                                                                                                                                                  |
| Any self-signed certificate passing as a seal                                                       | `verify()` must compare the signer certificate with the operator's certificate (fingerprint or chain to a configured root), not only check the maths                                                                  | PDF, Server                  | PDF          | Without it, anyone can re-seal an altered document with their own key                                                                            |

### 7. Image bombs and hostile signature uploads

| Threat                                      | Control                                                                                                             | Where                                   | Status                      | Residual risk                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| Oversized image                             | 512 KB cap, checked on the base64 length before decoding and again after                                            | `core/src/validation.ts` `normalizePng` | Done; property-tested       |                                                                                                |
| Tiny PNG declaring a giant canvas           | Declared width and height must be at most 2048 pixels (`MAX_IMAGE_DIMENSION`)                                       | `core/src/validation.ts`                | Done (new); property-tested | A valid header can still carry a hostile IDAT; decoding must use a decoder with its own limits |
| SVG, HTML or other types sent as "images"   | Only real PNG signature + IHDR is accepted; other `data:` types fail                                                | `core/src/validation.ts`                | Done; property-tested       |                                                                                                |
| Malformed PNG chunks exploiting the decoder | Re-encode every signature image server-side with a maintained decoder before drawing it; reject on any decode error | Server, PDF                             | Server / PDF                |                                                                                                |

### 8. Webhooks

| Threat                                        | Control                                                                                                           | Where                                             | Status     | Residual risk                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofed provider webhook                      | HMAC check (constant-time) plus confirmation through the provider's status API; optional static header            | `aadhaar/src/leegality/webhook.ts`, `provider.ts` | Done       | With `confirmWebhooks: false`, anyone who has seen one valid callback for a document can forge any status for it, because the mac covers only the document id |
| Oversized webhook body                        | Refused over 256 KB before parsing                                                                                | `aadhaar/src/leegality/webhook.ts`                | Done (new) | The server should also cap the route's body size                                                                                                              |
| Spoofed outbound webhook (to the integrator)  | HMAC-SHA256 over `timestamp.body` with a per-endpoint secret, sent in a header with the timestamp and an event id | Server                                            | Server     |                                                                                                                                                               |
| SSRF through integrator-supplied webhook URLs | See the rules below                                                                                               | Server                                            | Server     |                                                                                                                                                               |

Webhook URL rules for the server (apply at registration and again at delivery, after DNS
resolution, because DNS can change):

1. `https` only. Plain `http` only when the operator sets an explicit development flag.
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

| Comparison                             | Control                                                              | Where                              | Status |
| -------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- | ------ |
| Signing token vs stored hash           | Constant-time compare of hashes                                      | `core/src/security.ts`             | Done   |
| OTP vs stored hash                     | Constant-time compare; malformed input hashed the same way           | `core/src/security.ts`             | Done   |
| Provider webhook mac and static header | `crypto.timingSafeEqual` on equal-length buffers                     | `aadhaar/src/leegality/webhook.ts` | Done   |
| API keys                               | Store `sha256(key)`, look up by hash, compare with `timingSafeEqual` | Server                             | Server |
| Token lookup                           | Look up by `tokenHash`, never by the raw token or a prefix of it     | Server                             | Server |

Residual risk: length differences leak, which is harmless for fixed-length hashes.

### 10. Log and error leakage

| Rule                                                                                                                                                             | Where                       | Status            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------- |
| Errors from core and aadhaar carry codes and safe details only, never tokens, codes, credentials or document bytes                                               | core, aadhaar (tested)      | Done              |
| No package in this repository logs                                                                                                                               | All packages                | Done              |
| The server logs request ids, envelope ids and error codes, not bodies, query strings, `Authorization`, cookies, tokens, OTPs, signature images or document names | Server                      | Server            |
| Access logs strip the query string and path segment that carries a signing token                                                                                 | Server, proxy               | Server / Operator |
| Configuration errors name variables, never their values                                                                                                          | `apps/server/src/config.ts` | Done              |
| Provider error messages are passed through as text; they never contain our credentials but may name the document                                                 | aadhaar                     | Done              |

### 11. Seal key (PKCS#12)

| Threat                                 | Control                                                                                                                                                          | Where         | Status                        | Residual risk                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key theft from the image or repository | The key is supplied at run time (`SEAL_P12_BASE64`, `SEAL_P12_PASSPHRASE`), never baked into the image                                                           | `apps/server` | Done                          | Environment variables are visible to anyone who can inspect the container; prefer a mounted secret file or a KMS                                        |
| Key in memory dumps or logs            | Decode once at start-up, keep only the parsed key object, never log or return it, wipe the base64 buffer after parsing                                           | Server, PDF   | Server                        |                                                                                                                                                         |
| Weak key                               | Require RSA ≥ 2048 or ECDSA P-256, SHA-256 digests, a certificate that is not expired; refuse to start otherwise                                                 | PDF, Server   | PDF / Server                  |                                                                                                                                                         |
| Compromised key                        | Rotation: new certificate, restart; files sealed earlier keep verifying against the old certificate, which the operator must keep (public part) for verification | Operator      | Operator                      | A stolen key can seal forged files that pass `verify()` until the operator revokes the certificate; external timestamps on audit heads limit the damage |
| Signer's intent attributed to the seal | The seal proves the file has not changed since sealing; intent is proven by the audit trail. The certificate page says so                                        | Docs, PDF     | Done (`docs/ARCHITECTURE.md`) |                                                                                                                                                         |

### 12. Other notes

- **Back-dated `date_signed` values.** Core ignores any value a signer submits for a
  `date_signed` field and stores the server's time of signing instead, as a full ISO date-time
  in UTC taken from the same clock as the `recipient.signed` audit event. The drawn date is
  formatted from that value (in the signer's time zone when the server passes one), and the
  certificate page shows the exact UTC time of every event, so the two can always be compared.
- **Viewers and the completed copy.** Every recipient, including viewers, is sent the completed
  copy. Senders should treat the recipient list as the distribution list.
- **Provider signing links.** The Aadhaar adapter refuses a signing link that is not `https`, so a
  tampered provider response cannot send a signer to a `javascript:` or `http:` URL.
- **Provider responses.** Signed files and JSON from the provider are read with a streaming cap,
  so a missing or false `Content-Length` cannot make the server buffer without limit.
