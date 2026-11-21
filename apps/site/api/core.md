---
title: '@codevibe_technology/sign-core'
description: API reference for @codevibe_technology/sign-core, the pure domain rules of Codevibe Sign - envelopes, workflow, audit chain, tokens and OTPs.
---

# @codevibe_technology/sign-core

The domain model and rules: envelopes, recipients and fields, the signing workflow, reminders
and expiry, the hash-chained audit log, signing tokens and OTPs. No runtime dependencies and no
I/O. Time, ids, randomness and hashing are passed in as ports, so the same code runs in Node, in
the browser and in tests.

```sh
pnpm add @codevibe_technology/sign-core
```

Node 20 or later, or any runtime with Web Crypto.

## Errors

Rejected actions throw a `SignError` with a stable `code` (`NOT_YOUR_TURN`,
`ENVELOPE_EXPIRED`, `REQUIRED_FIELDS_MISSING`, ...). Validation errors use `VALIDATION`
and list every problem in `details.issues` as `{ path, message }`, where `path` names the
field to fix, for example `recipients.r1.email`.

## Building a draft

Edits are allowed only while the envelope is a `draft`.

| Function                                                             | Notes                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `createEnvelope(input, { clock, ids })` → `TransitionResult`         | Starts a draft; emits `envelope.created`.                                 |
| `updateEnvelope(envelope, patch, { clock })` → `Envelope`            | Title, message, routing, reminders, expiry, metadata.                     |
| `addDocument(envelope, input, { ids })` → `{ envelope, document }`   | `pageSizes` (PDF points) enables bounds checks for fields.                |
| `removeDocument(envelope, documentId)` → `Envelope`                  | Also removes its fields.                                                  |
| `addRecipient(envelope, input, { ids })` → `{ envelope, recipient }` | Defaults: `signer`, next order, `email_link` (or `sms_otp` with a phone). |
| `updateRecipient(envelope, recipientId, patch)` → `Envelope`         |                                                                           |
| `removeRecipient(envelope, recipientId)` → `Envelope`                | Also removes their fields.                                                |
| `addField(envelope, input, { ids })` → `{ envelope, field }`         | Signers and approvers only; box must sit inside the page.                 |
| `moveField(envelope, fieldId, { rect, page?, documentId? })`         |                                                                           |
| `removeField(envelope, fieldId)` → `Envelope`                        |                                                                           |
| `validateForSend(envelope, now)` → `ValidationIssue[]`               | Empty means ready. Every signer needs a required signature field.         |

## Workflow

All take `{ clock }` and return `TransitionResult` (`{ envelope, events, effects }`).

| Function                                                      | Notes                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `send(envelope, deps, { context? })`                          | Invites whoever may act first.                                  |
| `markViewed(envelope, { recipientId, context? }, deps)`       |                                                                 |
| `markAuthenticated(envelope, { recipientId, method? }, deps)` | Call after the OTP or other check succeeds.                     |
| `submit(envelope, { recipientId, values, context? }, deps)`   | Signers sign, approvers approve. Completes when all have acted. |
| `decline(envelope, { recipientId, reason, context? }, deps)`  | Stops the envelope for everyone.                                |
| `voidEnvelope(envelope, { reason, context? }, deps)`          | Sender withdraws it.                                            |
| `tick(envelope, now)`                                         | Sends due reminders or expires the envelope. Idempotent.        |
| `recordSeal(envelope, { documentId, sha256 }, deps)`          | Logs `document.sealed` after the server seals a file.           |

Helpers: `currentRecipients(envelope)`, `isFinal(envelopeOrStatus)`, `isActive`,
`hasActed`, `isExpiredAt`, `nextReminderAt`, and `nextTickAt(envelope)`, the next moment
`tick` has work to do, for scheduling.

In `sequential` routing the unfinished signers and approvers with the lowest `order` act
first, and equal orders act together. In `parallel` routing everyone acts at once.
Viewers never act; they receive the completed copy.

Submitted values are checked against the field type: signatures and initials must be
real PNGs (base64 or a `data:image/png;base64,` URL) of at most 512 KB, dates ISO,
checkboxes `'true'` or `'false'`, text at most 1000 characters. Date-signed and name
fields are filled in when left empty.

## Audit log

`hash = sha256(prevHash + canonicalize(event))`, starting from `GENESIS_HASH` (64 zeros).

- `canonicalize(event)`: JSON with sorted keys, without `prevHash` and `hash`.
- `appendEvents(prevHead, seqStart, events, hasher)` → `Promise<AuditEvent[]>`
- `commitTransition(result, nextSeq, hasher)`: chains a transition's events and sets
  `envelope.auditHead`.
- `verifyChain(events, hasher, { expectedHead? })` → `{ valid: true, head }` or
  `{ valid: false, brokenAt, reason }`.

## Tokens and OTPs

- `createSigningToken(random)` → `{ token, tokenHash }`: 32 random bytes, base64url.
  Store only the hash. `hashToken(token)` and `verifyToken(token, hash)`;
  `isSigningTokenShape(value)` checks that a value looks like an issued token (43 base64url
  characters) before you hash or look it up.
- `createOtp(random, clock)` → `{ code, codeHash, expiresAt, state }`: 6 digits, valid
  for 10 minutes, salted hash. Store `state`, send `code`.
- `verifyOtp(state, code, clock)` → `{ ok, state, ... }`. Persist the returned state on
  every call. Failures carry `OTP_INVALID`, `OTP_EXPIRED` or `OTP_LOCKED` (after 5 wrong
  attempts) and a ready `SignError`. Comparisons are constant time.

## Defaults

`webCryptoHasher`, `systemClock`, `randomIds` and `cryptoRandom` implement the
`Hasher`, `Clock`, `IdGenerator` and `RandomSource` ports with Web Crypto.

## Ports

Implemented by the server or by you. Core functions take the ports they need as arguments;
nothing is global.

| Port            | Methods                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `EnvelopeStore` | `get`, `save(envelope, events, expectedVersion?)`, `listEvents`, `due(now, limit)` |
| `FileStore`     | `put(key, bytes, contentType)`, `get(key)`, `delete(key)`                          |
| `Mailer`        | `send(message)`                                                                    |
| `OtpSender`     | `send(recipient, code)`                                                            |
| `Clock`         | `now()`                                                                            |
| `IdGenerator`   | `id()`                                                                             |
| `RandomSource`  | `bytes(length)`                                                                    |
| `Hasher`        | `sha256(data)`, lowercase hex                                                      |

## Error codes

`ENVELOPE_NOT_FOUND`, `INVALID_STATE`, `NOT_YOUR_TURN`, `RECIPIENT_NOT_FOUND`,
`REQUIRED_FIELDS_MISSING`, `FIELD_NOT_YOURS`, `INVALID_FIELD_VALUE`, `ENVELOPE_EXPIRED`,
`OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `RATE_LIMITED`, `TOKEN_INVALID`,
`DOCUMENT_TOO_LARGE`, `DOCUMENT_INVALID`, `PDF_ALREADY_SIGNED`, `SEAL_FAILED`, `PROVIDER_ERROR`,
`WEBHOOK_INVALID`, `VALIDATION`.
