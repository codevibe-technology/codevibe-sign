---
title: Envelopes
description: An envelope is one signing request. Learn its parts, its statuses and how every change becomes an audit event.
---

# Envelopes

An envelope is one signing request: the documents to sign, the people involved, where each of
them signs, and the rules for order, reminders and expiry.

```
Envelope ──< Document ──< Field >── Recipient
    │                                   │
    └──────────── AuditEvent ───────────┘
```

| Part         | What it holds                                                                   |
| ------------ | ------------------------------------------------------------------------------- |
| `documents`  | One or more PDFs, each with its SHA-256, page count and page sizes.             |
| `recipients` | Signers, approvers and viewers. See [Recipients](./recipients).                 |
| `fields`     | Boxes on pages, each owned by one recipient. See [Fields](./fields).            |
| `routing`    | `sequential` (the default) or `parallel`. See [Routing](./routing).             |
| `reminders`  | `{ firstAfterDays, everyDays, max }`, by default 3, 3 and 3.                    |
| `expiresAt`  | Optional. Past this time the envelope expires.                                  |
| `changeNote` | Optional. For a revised envelope, what changed; shown to recipients.            |
| `metadata`   | Your own string data, for example an employee id. Codevibe Sign never reads it. |
| `auditHead`  | The hash at the head of the audit chain. See [Audit chain](./audit-chain).      |

## Status

```
draft ──send──▶ sent ──first signature──▶ in_progress ──last required action──▶ completed
                 │                            │
                 ├── declined (any signer) ◀──┤
                 ├── expired  (past expiry) ◀─┤
                 └── voided   (sender)     ◀──┘
```

- **draft**: documents, recipients and fields can still be edited.
- **sent**: invitations are out; no one has signed yet.
- **in_progress**: at least one person has acted.
- **completed**, **declined**, **expired**, **voided**: final. Nothing changes after these.

Before sending, `validateForSend` checks the draft and returns every problem at once, each with
a `path` that names what to fix, such as `recipients.r1.email`. Every signer needs at least one
required signature field.

## Transitions are pure

Each step (`send`, `markViewed`, `submit`, `decline`, `voidEnvelope`, `tick`) is a pure
function in `@codevibe_technology/sign-core`. It returns:

- the new `envelope`;
- the `events` to append to the audit log;
- the `effects` to carry out: emails to send, webhooks to fire, or a file to seal.

Core never touches the network, the disk or the clock directly. The server, or your own code,
saves the result and performs the effects. That makes the rules easy to test and the same in
every runtime.

Rejected actions throw a `SignError` with a stable `code`, such as `NOT_YOUR_TURN`,
`ENVELOPE_EXPIRED` or `REQUIRED_FIELDS_MISSING`.

## Next

[Recipients](/concepts/recipients)
