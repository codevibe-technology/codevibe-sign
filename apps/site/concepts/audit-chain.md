---
title: Audit chain
description: Every action is appended to a log chained with SHA-256, so removing or changing any event can be detected offline.
---

# Audit chain

Every action on an envelope is an audit event: created, sent, notified, reminded, viewed,
authenticated, signed, approved, declined, expired, voided, completed and sealed. Events are
append-only and each one is chained to the one before it.

## How the chain is built

```
hash = sha256(prevHash + canonicalize(event))
```

- The first event's `prevHash` is `GENESIS_HASH`, 64 zeros.
- `canonicalize(event)` is JSON with sorted keys, without `prevHash` and `hash`, so the same
  event always produces the same bytes.
- `seq` counts from 1 with no gaps.
- The last hash is stored on the envelope as `auditHead` and printed on the certificate page.

Each event records the time, the recipient, and the IP address and user agent where they were
available. Personal data is limited to what the certificate needs.

## Verifying

<!-- check:
import type { AuditEvent, Envelope } from '@codevibe_technology/sign-core';
declare const events: AuditEvent[];
declare const envelope: Envelope;
-->

```ts check
import { verifyChain, webCryptoHasher } from '@codevibe_technology/sign-core';

const result = await verifyChain(events, webCryptoHasher, { expectedHead: envelope.auditHead });

if (!result.valid) {
  console.log(`Broken at event ${result.brokenAt}: ${result.reason}`);
}
```

`reason` says what failed: `seq` (a gap or reorder), `prev_hash` or `hash` (an event was
changed), `envelope` (an event from another envelope), or `head` (events were cut off the end).
Passing `expectedHead` is what catches truncation, so compare against the head printed on the
certificate page.

## Why a chain

A database row can be edited. A chain makes editing visible: change any event and its hash no
longer matches, and neither does any event after it. Because the head is also printed inside
the sealed PDF, the log and the file vouch for each other.
