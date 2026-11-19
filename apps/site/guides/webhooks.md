---
title: Webhooks
description: Receive signed webhook events from the server when envelopes change, and verify them before you trust them.
---

# Webhooks

The server tells your backend when something happens to an envelope by sending a webhook. Each
one corresponds to an audit action: `envelope.created`, `envelope.sent`, `envelope.completed`,
`envelope.declined`, `envelope.expired`, `envelope.voided`, `recipient.notified`,
`recipient.reminded`, `recipient.viewed`, `recipient.authenticated`, `recipient.signed`,
`recipient.approved`, `recipient.declined` and `document.sealed`.

## Targets

List the endpoints in the server options. `events` names the actions a target wants, or `*`
for all of them.

```ts check
import type { WebhookTarget } from '@codevibe/sign-server';

const webhooks: WebhookTarget[] = [
  {
    url: 'https://hr.example.com/hooks/sign',
    secret: process.env.SIGN_WEBHOOK_SECRET!,
    events: ['envelope.completed', 'envelope.declined', 'document.sealed'],
  },
];
```

Pass them as `webhooks` to `createSignServer`, or in the `overrides` of `startSignServer`.

The server checks each URL when it starts and again before every delivery: it must be
`https` on a host name (not an IP address), without credentials or a privileged port other
than 443. At delivery the host is resolved, and the request is refused if any address is
loopback, private, link-local (including `169.254.169.254`), CGNAT, multicast or reserved,
in IPv4 or IPv6. The connection goes to the address that was checked, redirects are not
followed, and only the status code of the answer matters.

To deliver to an internal service, list it in `webhookSecurity.allowHosts`; only listed hosts
are then accepted, wherever they resolve. For a receiver on your own machine during
development, set `webhookSecurity: { allowInsecure: true }`, which also allows `http://` and
local addresses. Never set it in production.

## The request

Each delivery is a `POST` with a JSON body:

```json
{
  "id": "3f9a1c0e-…",
  "type": "envelope.completed",
  "createdAt": "2026-11-19T10:42:07.000Z",
  "data": {
    "envelope": {
      "id": "6b2e4d71-…",
      "title": "Offer letter",
      "status": "completed",
      "metadata": { "employeeId": "E42" },
      "completedAt": "2026-11-19T10:42:07.000Z",
      "recipients": [
        {
          "id": "a71d09c2-…",
          "name": "Asha Rao",
          "email": "asha@example.com",
          "role": "signer",
          "status": "signed",
          "actedAt": "2026-11-19T10:42:06.000Z"
        }
      ]
    }
  }
}
```

and these headers:

| Header                 | Value                                                   |
| ---------------------- | ------------------------------------------------------- |
| `content-type`         | `application/json`                                      |
| `user-agent`           | `codevibe-sign-webhooks`                                |
| `x-codevibe-delivery`  | The delivery id, the same as `id` in the body           |
| `x-codevibe-signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` |

## Verifying the signature

The signature is HMAC-SHA256, keyed with the target's `secret`, over the string
`<t>.<raw body>`: the timestamp from the header, a dot, then the body bytes exactly as
received. Verify it before you act on the event, and reject timestamps more than five minutes
from your clock so a captured request cannot be replayed.

`verifyWebhook(secret, header, rawBody, options?)` from `@codevibe/sign-server` does all of
this with a constant-time comparison. `options.toleranceSeconds` changes the five-minute
window.

```ts check
import { createServer } from 'node:http';
import { verifyWebhook } from '@codevibe/sign-server';

const secret = process.env.SIGN_WEBHOOK_SECRET!;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const header = req.headers['x-codevibe-signature'];
  if (!verifyWebhook(secret, typeof header === 'string' ? header : null, rawBody)) {
    res.writeHead(401).end();
    return;
  }
  const event = JSON.parse(rawBody) as { id: string; type: string };
  res.writeHead(204).end();
  // Hand the event to a queue here; answer first, work later.
  console.log(event.type, event.id);
}).listen(4000);
```

Parse the JSON only after the check, and never re-serialise it before verifying: a different
key order or spacing changes the bytes and the signature no longer matches.

Without the package, the check is a few lines of `node:crypto`:

```ts check
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret: string, header: string, rawBody: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const given = Buffer.from(String(parts.v1 ?? ''));
  return given.length === expected.length && timingSafeEqual(given, Buffer.from(expected));
}
```

## Delivery

- A delivery counts as done when your endpoint answers 2xx within 10 seconds. Redirects are
  not followed.
- Anything else is retried from an outbox with backoff, from 30 seconds up to 12 hours, nine
  attempts in all. Each attempt is signed again with a fresh `t`; the body and the delivery id
  stay the same.
- The same event can therefore arrive more than once. Use the delivery id to ignore
  duplicates.
- Answer quickly and do slow work in the background.
- Use the envelope's `metadata` to link events back to your own records, such as an employee
  id.
