---
title: "Webhooks"
description: "The events the server posts to your webhook URLs, their payloads, and how to verify a delivery."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Webhooks

The server posts an event to your webhook URLs when something happens to an envelope, so your backend never has to poll. Each event is one audit action; a target subscribes to the actions it wants, or `*` for all.

Webhook targets are set in the server options, or in workspace settings on the cloud. The [webhooks guide](/guides/webhooks) covers setting them up and testing them.

</div>
<div class="api-op__aside">

<div class="api-endpoints">
<p class="api-endpoints__title">Event types</p>
<ul class="api-endpoints__plain">
<li><code>envelope.created</code></li>
<li><code>envelope.updated</code></li>
<li><code>envelope.sent</code></li>
<li><code>envelope.completed</code></li>
<li><code>envelope.declined</code></li>
<li><code>envelope.expired</code></li>
<li><code>envelope.voided</code></li>
<li><code>recipient.notified</code></li>
<li><code>recipient.reminded</code></li>
<li><code>recipient.viewed</code></li>
<li><code>recipient.authenticated</code></li>
<li><code>recipient.signed</code></li>
<li><code>recipient.approved</code></li>
<li><code>recipient.declined</code></li>
<li><code>recipient.link_shared</code></li>
<li><code>recipient.corrected</code></li>
<li><code>recipient.esign_started</code></li>
<li><code>recipient.esign_failed</code></li>
<li><code>recipient.esign_name_differs</code></li>
<li><code>envelope.recalled</code></li>
<li><code>envelope.revised</code></li>
<li><code>document.sealed</code></li>
</ul>
</div>

</div>
</section>

<section class="api-op" aria-labelledby="verify-a-delivery">
<div class="api-op__main">

## Verify a delivery {#verify-a-delivery}

Every delivery is signed with the secret of its target. Check the signature before you trust the body:

1. Read the raw body exactly as received. Do not parse and re-serialise it first.
2. Split `x-codevibe-signature` into `t` (unix seconds) and `v1` (hex).
3. Compute HMAC-SHA256 of `<t>.<raw body>` with the secret, and compare it with `v1` in constant time.
4. Reject the delivery when `t` is more than five minutes from your clock, so a captured request cannot be replayed.

Answer with a 2xx within 10 seconds and do the work afterwards. A delivery that fails is retried with the same `id`, so drop ids you have already handled.

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Verify">

::: code-group

```ts check [Node.js]
import { createServer } from 'node:http';
import { readWebhook, SignApiError } from '@codevibe_technology/sign-client';

const secret = process.env.SIGN_WEBHOOK_SECRET!;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  try {
    const delivery = await readWebhook(secret, req.headers['x-codevibe-signature'], rawBody);
    res.writeHead(204).end();
    if (delivery.type === 'envelope.completed') {
      console.log('completed', delivery.data.envelope.id);
    }
  } catch (error) {
    res.writeHead(error instanceof SignApiError ? 401 : 500).end();
  }
}).listen(4000);
```

```python [Python]
import hashlib
import hmac
import time

def verify_webhook(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(",") if "=" in part)
    timestamp, signature = parts.get("t", ""), parts.get("v1", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > tolerance:
        return False
    signed = timestamp.encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

```go [Go]
package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"time"
)

func VerifyWebhook(secret, header string, rawBody []byte, tolerance time.Duration) bool {
	var timestamp, signature string
	for _, part := range strings.Split(header, ",") {
		key, value, _ := strings.Cut(part, "=")
		switch key {
		case "t":
			timestamp = value
		case "v1":
			signature = value
		}
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || math.Abs(time.Since(time.Unix(seconds, 0)).Seconds()) > tolerance.Seconds() {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="envelope-event">
<div class="api-op__main">

## Envelope event {#envelope-event}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>your webhook URL</code></p>

Sent to each configured webhook URL for the audit actions it subscribes to (`*` for
all), one delivery per action. The body is fixed when the event happens, so a retry
delivers the same bytes with the same `id`. Failed deliveries (no 2xx within 10 s) are
retried with backoff, from 30 seconds up to 12 hours, nine attempts in all.

Verify each delivery before trusting it: the `x-codevibe-signature` header is
`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` with the target's secret.
Reject it when the HMAC does not match or `t` is more than five minutes old.
`verifyWebhook(secret, header, rawBody)` from the server or client package does this.

### Headers {#envelope-event-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x-codevibe-signature</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.

<p class="api-field__meta">Matches <code>^t=\d+,v1=[0-9a-f]{64}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x-codevibe-delivery</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The delivery id, the same as `id` in the body. Use it to drop duplicates.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">user-agent</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">Always <code>codevibe-sign-webhooks</code></p>

</div>

</div>

### Body {#envelope-event-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

The delivery id; the same on every retry.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>envelope.created</code> <code>envelope.updated</code> <code>envelope.sent</code> <code>envelope.completed</code> <code>envelope.declined</code> <code>envelope.expired</code> <code>envelope.voided</code> <code>recipient.notified</code> <code>recipient.reminded</code> <code>recipient.viewed</code> <code>recipient.authenticated</code> <code>recipient.signed</code> <code>recipient.approved</code> <code>recipient.declined</code> <code>recipient.link_shared</code> <code>recipient.corrected</code> <code>recipient.esign_started</code> <code>recipient.esign_failed</code> <code>recipient.esign_name_differs</code> <code>envelope.recalled</code> <code>envelope.revised</code> <code>document.sealed</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">createdAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">data</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>data</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">envelope</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>envelope</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string</span></p>

`completed`, `declined`, `expired` and `voided` are final.

<p class="api-field__meta">One of <code>draft</code> <code>sent</code> <code>in_progress</code> <code>completed</code> <code>declined</code> <code>expired</code> <code>voided</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">metadata</code> <span class="api-field__type">map</span></p>

Your own data, for example an employee id. Echoed in webhooks.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">completedAt</code> <span class="api-field__type">string (date-time) or null</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipients</code> <span class="api-field__type">array of objects</span></p>

<details class="api-field__children">
<summary>Attributes of <code>recipients</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">email</code> <span class="api-field__type">string or null</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">role</code> <span class="api-field__type">string</span></p>

Signers fill fields, approvers approve without fields, viewers get a copy.

<p class="api-field__meta">One of <code>signer</code> <code>approver</code> <code>viewer</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>pending</code> <code>notified</code> <code>viewed</code> <code>signed</code> <code>approved</code> <code>declined</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">actedAt</code> <span class="api-field__type">string (date-time) or null</span></p>

</div>

</div>

</details>

</div>

</div>

</details>

</div>

</div>

</details>

</div>

</div>

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Payload">

::: code-group

```json [POST]
{
  "id": "5a7e3c1d-8b2f-4d6a-9e0c-1f4b7a2d3e58",
  "type": "envelope.completed",
  "createdAt": "2026-03-02T09:14:31.000Z",
  "data": {
    "envelope": {
      "id": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
      "title": "Offer letter",
      "status": "completed",
      "metadata": {
        "employeeId": "E-1042"
      },
      "completedAt": "2026-03-02T09:14:31.000Z",
      "recipients": [
        {
          "id": "c4a1d9e2-7f3b-4c8d-a6e5-0b9f2d1c7e83",
          "name": "Asha Rao",
          "email": "asha@example.com",
          "role": "signer",
          "status": "signed",
          "actedAt": "2026-03-02T09:12:05.000Z"
        }
      ]
    }
  }
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="test-event">
<div class="api-op__main">

## Test event {#test-event}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>your webhook URL</code></p>

Sent when someone asks for a test delivery, for example with "Send test event" in the
app, to check that the receiver is reachable and verifies signatures. It is signed and
carries the same headers as an envelope event, but has no envelope and is never
retried. Answer it like any other delivery.

### Headers {#test-event-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x-codevibe-signature</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.

<p class="api-field__meta">Matches <code>^t=\d+,v1=[0-9a-f]{64}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x-codevibe-delivery</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The delivery id, the same as `id` in the body.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">user-agent</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">Always <code>codevibe-sign-webhooks</code></p>

</div>

</div>

### Body {#test-event-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

The delivery id.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Always <code>webhook.test</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">createdAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">data</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>data</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string</span></p>

</div>

</div>

</details>

</div>

</div>

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Payload">

::: code-group

```json [POST]
{
  "id": "9c2e4b7a-1d3f-4a6e-8b0c-5e7f9a1b3d24",
  "type": "webhook.test",
  "createdAt": "2026-03-02T09:20:00.000Z",
  "data": {
    "message": "This is a test event from Codevibe Sign. Answer with any 2xx status."
  }
}
```

:::

</div>

</div>
</section>
