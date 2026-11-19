---
title: Webhooks
description: Receive signed webhook events from the server when envelopes change, and verify them before you trust them.
---

# Webhooks

<ComingSoon pkg="@codevibe/sign-server" />

The server tells your backend when something happens to an envelope by sending a webhook. Each
one corresponds to an audit action, such as `envelope.sent`, `recipient.signed`,
`envelope.completed` or `document.sealed`.

## Signing

Every webhook is signed with HMAC-SHA256 over a timestamp and the raw body, using a secret you
share with the server. Verify the signature before you act on the event, and reject requests
whose timestamp is too old, so a captured request cannot be replayed later.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

The header names and the exact string that is signed will be confirmed here when the server is
released.

## Delivery

- Failed deliveries are retried with backoff, so the same event can arrive more than once.
  Make your handler idempotent, for example by storing the event's envelope id and sequence
  number.
- Answer quickly with a 2xx status and do slow work in the background.
- Use the envelope's `metadata` to link events back to your own records, such as an employee id.
