---
title: "Recipients"
description: "The people on an envelope."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Recipients

The people on an envelope. Remind them, correct a mistyped address, or get a signing
link to pass on yourself. Sender API key required.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#remind-recipients"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/remind</code></a></li>
<li><a href="#share-signing-link"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/recipients/{recipientId}/link</code></a></li>
<li><a href="#correct-recipient"><span class="api-method" data-method="patch">PATCH</span><code>/v1/envelopes/{id}/recipients/{recipientId}</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="the-recipient-object">
<div class="api-op__main">

## The recipient object {#the-recipient-object}

### Attributes {#the-recipient-object-attributes}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">email</code> <span class="api-field__type">string (email)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">phone</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Matches <code>^\+[1-9]\d{6,14}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">role</code> <span class="api-field__type">string</span></p>

Signers fill fields, approvers approve without fields, viewers get a copy.

<p class="api-field__meta">One of <code>signer</code> <code>approver</code> <code>viewer</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">order</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">auth</code> <span class="api-field__type">string</span></p>

How the recipient proves who they are. `email_otp`, the default, asks for the link and a code sent by email; `email_link` needs only the link.

<p class="api-field__meta">One of <code>email_link</code> <code>email_otp</code> <code>sms_otp</code> <code>aadhaar</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>pending</code> <code>notified</code> <code>viewed</code> <code>signed</code> <code>approved</code> <code>declined</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">declineReason</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">actedAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">notifiedAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">viewedAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">remindersSent</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">lastRemindedAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>

</div>

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Example">

::: code-group

```json [Recipient]
{
  "id": "c4a1d9e2-7f3b-4c8d-a6e5-0b9f2d1c7e83",
  "name": "Asha Rao",
  "email": "asha@example.com",
  "role": "signer",
  "order": 1,
  "auth": "email_otp",
  "status": "notified",
  "notifiedAt": "2026-03-02T09:00:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="remind-recipients">
<div class="api-op__main">

## Remind recipients {#remind-recipients}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/remind</code></p>

Mails a reminder with a fresh signing link to everyone whose turn it is, or to the one
recipient named. Each recipient gets at most one reminder or invitation every 15
minutes; manual reminders do not count against the automatic ones.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#remind-recipients-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Headers {#remind-recipients-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#remind-recipients-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipientId</code> <span class="api-field__type">string</span></p>

Remind only this recipient.

</div>

</div>

### Returns {#remind-recipients-returns}

**200 OK**. The envelope, with `lastRemindedAt` set on everyone reminded. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#remind-recipients-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 410 | `ENVELOPE_EXPIRED`: the envelope is past its expiry. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/remind \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "recipientId": "rcp_01"
}'
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/remind', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SIGN_API_KEY}`,
    'Idempotency-Key': '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    recipientId: 'rcp_01',
  }),
});
console.log(response.status, await response.json());
```

```python [Python]
import os

import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/remind",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "recipientId": "rcp_01",
    },
    timeout=30,
)

response.raise_for_status()
print(response.json())
```

```go [Go]
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	payload, err := json.Marshal(map[string]any{
		"recipientId": "rcp_01",
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/remind", bytes.NewReader(payload))
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SIGN_API_KEY"))
	req.Header.Set("Idempotency-Key", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	out, err := io.ReadAll(res.Body)
	if err != nil {
		panic(err)
	}
	fmt.Println(res.Status, string(out))
}
```

:::

<ApiTryIt operation="remindRecipients" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "id": "string",
  "title": "string",
  "message": "string",
  "changeNote": "string",
  "status": "draft",
  "routing": "sequential",
  "documents": [
    {
      "id": "string",
      "name": "string",
      "sha256": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c",
      "pageCount": 1,
      "pageSizes": [
        {
          "width": 1,
          "height": 1
        }
      ]
    }
  ],
  "recipients": [
    {
      "id": "string",
      "name": "string",
      "email": "asha@example.com",
      "phone": "+919876543210",
      "role": "signer",
      "order": 1,
      "auth": "email_link",
      "status": "pending",
      "declineReason": "string",
      "actedAt": "2026-03-02T09:14:31.000Z",
      "notifiedAt": "2026-03-02T09:14:31.000Z",
      "viewedAt": "2026-03-02T09:14:31.000Z",
      "remindersSent": 0,
      "lastRemindedAt": "2026-03-02T09:14:31.000Z"
    }
  ],
  "fields": [
    {
      "id": "string",
      "documentId": "string",
      "recipientId": "string",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 0,
        "y": 0,
        "width": 1,
        "height": 1
      },
      "required": true,
      "label": "string",
      "readOnly": true
    }
  ],
  "values": [
    {
      "fieldId": "string",
      "value": "string"
    }
  ],
  "reminders": {
    "firstAfterDays": 0,
    "everyDays": 1,
    "max": 0
  },
  "expiresAt": "2026-03-02T09:14:31.000Z",
  "createdAt": "2026-03-02T09:14:31.000Z",
  "sentAt": "2026-03-02T09:14:31.000Z",
  "completedAt": "2026-03-02T09:14:31.000Z",
  "metadata": {},
  "auditHead": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="share-signing-link">
<div class="api-op__main">

## Get a signing link to pass on yourself {#share-signing-link}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/recipients/{recipientId}/link</code></p>

A fresh signing link for a recipient whose turn it is, for when emails do not reach
them. No email is sent. Their earlier links stop working, so only the newest one
does. A one-time code still applies when the recipient signs with one. The audit
trail records `recipient.link_shared` with who took the link, never the link itself.
At most 5 links per recipient per hour. The link is in this response only and is never
stored in clear, so an `Idempotency-Key` is ignored: a retry gives a new link.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#share-signing-link-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipientId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The recipient id, from `recipients[].id`.

</div>

</div>

### Returns {#share-signing-link-returns}

**201 Created**. The link. Treat it like a password. An object.

### Errors {#share-signing-link-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 410 | `ENVELOPE_EXPIRED`: the envelope is past its expiry. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recipients/4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e/link \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const { url } = await sign.envelopes.shareLink('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37', '4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e');

// Treat the link like a password.
```

```python [Python]
import os

import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recipients/4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e/link",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
    },
    timeout=30,
)

response.raise_for_status()
print(response.json())
```

```go [Go]
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recipients/4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e/link", nil)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SIGN_API_KEY"))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	out, err := io.ReadAll(res.Body)
	if err != nil {
		panic(err)
	}
	fmt.Println(res.Status, string(out))
}
```

:::

<ApiTryIt operation="shareSigningLink" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [201 Created]
{
  "recipientId": "string",
  "url": "https://sign.example.com/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="correct-recipient">
<div class="api-op__main">

## Correct a recipient who has not acted {#correct-recipient}

<p class="api-route"><span class="api-method" data-method="patch">PATCH</span><code>/v1/envelopes/{id}/recipients/{recipientId}</code></p>

Changes the name, email or phone of a recipient on a sent envelope who has not signed,
approved or declined. Role, order and fields stay. Their earlier links stop working.
When it is their turn and the email or phone changed, the new address is invited at
once; a name change sends nothing unless `resend` is true. Recorded as
`recipient.corrected` with the old and new values. Someone who has acted cannot be
changed (`INVALID_STATE` with `details.reason: acted`); recall the envelope instead.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#correct-recipient-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipientId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The recipient id, from `recipients[].id`.

</div>

</div>

### Request body {#correct-recipient-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">At most 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">email</code> <span class="api-field__type">string (email)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">phone</code> <span class="api-field__type">string</span></p>

International format, for example +919876543210.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">resend</code> <span class="api-field__type">boolean</span></p>

Send a new invitation even when only the name changed.

</div>

</div>

### Returns {#correct-recipient-returns}

**200 OK**. The envelope after the correction. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

### Errors {#correct-recipient-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 410 | `ENVELOPE_EXPIRED`: the envelope is past its expiry. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X PATCH https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recipients/4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "email": "asha.rao@example.com"
}'
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.correctRecipient(
  '7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37',
  '4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e',
  {
    email: 'asha.rao@example.com',
  },
);
```

```python [Python]
import os

import requests

response = requests.patch(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recipients/4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
    },
    json={
        "email": "asha.rao@example.com",
    },
    timeout=30,
)

response.raise_for_status()
print(response.json())
```

```go [Go]
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	payload, err := json.Marshal(map[string]any{
		"email": "asha.rao@example.com",
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("PATCH", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recipients/4c2a9e1b-7d3f-4b6a-8e5c-1f0d2b3a4c5e", bytes.NewReader(payload))
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SIGN_API_KEY"))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	out, err := io.ReadAll(res.Body)
	if err != nil {
		panic(err)
	}
	fmt.Println(res.Status, string(out))
}
```

:::

<ApiTryIt operation="correctRecipient" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "id": "string",
  "title": "string",
  "message": "string",
  "changeNote": "string",
  "status": "draft",
  "routing": "sequential",
  "documents": [
    {
      "id": "string",
      "name": "string",
      "sha256": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c",
      "pageCount": 1,
      "pageSizes": [
        {
          "width": 1,
          "height": 1
        }
      ]
    }
  ],
  "recipients": [
    {
      "id": "string",
      "name": "string",
      "email": "asha@example.com",
      "phone": "+919876543210",
      "role": "signer",
      "order": 1,
      "auth": "email_link",
      "status": "pending",
      "declineReason": "string",
      "actedAt": "2026-03-02T09:14:31.000Z",
      "notifiedAt": "2026-03-02T09:14:31.000Z",
      "viewedAt": "2026-03-02T09:14:31.000Z",
      "remindersSent": 0,
      "lastRemindedAt": "2026-03-02T09:14:31.000Z"
    }
  ],
  "fields": [
    {
      "id": "string",
      "documentId": "string",
      "recipientId": "string",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 0,
        "y": 0,
        "width": 1,
        "height": 1
      },
      "required": true,
      "label": "string",
      "readOnly": true
    }
  ],
  "values": [
    {
      "fieldId": "string",
      "value": "string"
    }
  ],
  "reminders": {
    "firstAfterDays": 0,
    "everyDays": 1,
    "max": 0
  },
  "expiresAt": "2026-03-02T09:14:31.000Z",
  "createdAt": "2026-03-02T09:14:31.000Z",
  "sentAt": "2026-03-02T09:14:31.000Z",
  "completedAt": "2026-03-02T09:14:31.000Z",
  "metadata": {},
  "auditHead": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c"
}
```

:::

</div>

</div>
</section>
