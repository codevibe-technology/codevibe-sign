---
title: "Envelopes"
description: "An envelope is one signing job: its documents, the people who act on them, the fields they fill and where it stands."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Envelopes

An envelope is one signing job: its documents, the people who act on them, the fields
they fill and where it stands. Create, change, send, withdraw and list envelopes.
Sender API key required.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#list-envelopes"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes</code></a></li>
<li><a href="#create-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes</code></a></li>
<li><a href="#get-envelope"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}</code></a></li>
<li><a href="#update-envelope"><span class="api-method" data-method="patch">PATCH</span><code>/v1/envelopes/{id}</code></a></li>
<li><a href="#send-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/send</code></a></li>
<li><a href="#void-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/void</code></a></li>
<li><a href="#recall-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/recall</code></a></li>
<li><a href="#revise-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/revise</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="the-envelope-object">
<div class="api-op__main">

## The envelope object {#the-envelope-object}

### Attributes {#the-envelope-object-attributes}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">changeNote</code> <span class="api-field__type">string</span></p>

What changed since a declined version; shown to recipients.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string</span></p>

`completed`, `declined`, `expired` and `voided` are final.

<p class="api-field__meta">One of <code>draft</code> <code>sent</code> <code>in_progress</code> <code>completed</code> <code>declined</code> <code>expired</code> <code>voided</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">routing</code> <span class="api-field__type">string</span></p>

`sequential` goes by `order`, lowest first (equal orders sign together); `parallel` invites everyone at once.

<p class="api-field__meta">One of <code>sequential</code> <code>parallel</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">documents</code> <span class="api-field__type">array of objects</span></p>

<details class="api-field__children">
<summary>Attributes of <code>documents</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sha256</code> <span class="api-field__type">string</span></p>

SHA-256 of the original file.

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">pageCount</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">pageSizes</code> <span class="api-field__type">array of objects</span></p>

Size of each page in PDF points, in page order.

<details class="api-field__children">
<summary>Attributes of <code>pageSizes</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">width</code> <span class="api-field__type">number</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">height</code> <span class="api-field__type">number</span></p>

</div>

</div>

</details>

</div>

</div>

</details>

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
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">esign</code> <span class="api-field__type">object</span></p>

Where the recipient's Aadhaar eSign stands, once they have started one. Only for `auth: aadhaar`.

<details class="api-field__children">
<summary>Attributes of <code>esign</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">provider</code> <span class="api-field__type">string</span></p>

The eSign provider.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string</span></p>

`pending`: the recipient is at the provider. `expired` and `failed`: the attempt ended without a signature and the recipient may start again.

<p class="api-field__meta">One of <code>pending</code> <code>signed</code> <code>declined</code> <code>expired</code> <code>failed</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">signerName</code> <span class="api-field__type">string</span></p>

The name on the signer's eSign certificate in the signed file, or the name the provider reported when the file carried none that could be read.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">signedAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">ref</code> <span class="api-field__type">string</span></p>

The server's reference for the eSign request that was signed.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sandbox</code> <span class="api-field__type">boolean</span></p>

The provider's test environment was used. Such a signature is for testing and has no legal effect.

</div>

</div>

</details>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">fields</code> <span class="api-field__type">array of objects</span></p>

<details class="api-field__children">
<summary>Attributes of <code>fields</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">documentId</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipientId</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

A recipient with `auth: aadhaar` has no fields: the eSign provider places the signature
where its own workflow says, and signs the document as the sender approved it, with
the values of the signers before them. `signature`, `initials` and `aadhaar` fields
given to such a signer are dropped when the envelope is sent, so older requests still
work; any other field for them is refused with `VALIDATION`. `aadhaar`, the Aadhaar
eSign box, is read on envelopes sent while it marked where the signer signs; it takes
no value, and only an Aadhaar eSign signer may have one.

<p class="api-field__meta">One of <code>signature</code> <code>initials</code> <code>date_signed</code> <code>name</code> <code>text</code> <code>checkbox</code> <code>aadhaar</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">page</code> <span class="api-field__type">integer</span></p>

Zero-based page index.

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">rect</code> <span class="api-field__type">object</span></p>

A box in PDF points, measured from the top-left corner of the page.

<details class="api-field__children">
<summary>Attributes of <code>rect</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">y</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">width</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">height</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 1</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">required</code> <span class="api-field__type">boolean</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">label</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">readOnly</code> <span class="api-field__type">boolean</span></p>

Filled in by the sender; the recipient cannot change it.

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">values</code> <span class="api-field__type">array of objects</span></p>

<details class="api-field__children">
<summary>Attributes of <code>values</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">fieldId</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">value</code> <span class="api-field__type">string</span></p>

Signature and initials: PNG as base64. Text and name: the text. Checkbox: `true` or
`false`. Date: an ISO date. An `aadhaar` box takes no value; leave it out.

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">reminders</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>reminders</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">firstAfterDays</code> <span class="api-field__type">integer</span></p>

Days after the invitation for the first reminder; 0 turns reminders off.

<p class="api-field__meta">0 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">everyDays</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">1 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">max</code> <span class="api-field__type">integer</span></p>

Most reminders per recipient.

<p class="api-field__meta">0 to 50</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">expiresAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">createdAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sentAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">completedAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">metadata</code> <span class="api-field__type">map</span></p>

Your own data, for example an employee id. Echoed in webhooks.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">auditHead</code> <span class="api-field__type">string</span></p>

Hash of the last audit event.

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>

</div>

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Example">

::: code-group

```json [Envelope]
{
  "id": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
  "title": "Offer letter",
  "message": "Please sign by Friday.",
  "status": "sent",
  "routing": "sequential",
  "documents": [
    {
      "id": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "name": "offer.pdf",
      "sha256": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
      "pageCount": 1,
      "pageSizes": [
        {
          "width": 595.28,
          "height": 841.89
        }
      ]
    }
  ],
  "recipients": [
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
  ],
  "fields": [
    {
      "id": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "recipientId": "c4a1d9e2-7f3b-4c8d-a6e5-0b9f2d1c7e83",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 640,
        "width": 180,
        "height": 48
      },
      "required": true
    }
  ],
  "values": [],
  "reminders": {
    "firstAfterDays": 2,
    "everyDays": 2,
    "max": 3
  },
  "expiresAt": "2026-04-01T09:00:00.000Z",
  "createdAt": "2026-03-02T09:00:00.000Z",
  "sentAt": "2026-03-02T09:00:00.000Z",
  "metadata": {
    "employeeId": "E-1042"
  },
  "auditHead": "3b5f0c4d6e1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="list-envelopes">
<div class="api-op__main">

## List envelopes {#list-envelopes}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes</code></p>

The caller's workspace's envelopes, newest first, one page at a time. Pass the
`nextCursor` of a page as `cursor` to get the next one. Each row is a summary without
fields or values; get the envelope for those.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Results come one page at a time. See [pagination](/http-api/conventions#pagination).

### Query parameters {#list-envelopes-query}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string</span></p>

Only these states, comma separated.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">q</code> <span class="api-field__type">string</span></p>

Case-insensitive text anywhere in the title.

<p class="api-field__meta">At most 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">limit</code> <span class="api-field__type">integer</span></p>

Page size.

<p class="api-field__meta">Default <code>25</code><span aria-hidden="true"> · </span>1 to 100</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">cursor</code> <span class="api-field__type">string</span></p>

The `nextCursor` of the previous page.

</div>

</div>

### Returns {#list-envelopes-returns}

**200 OK**. One page of envelopes. An `EnvelopeList` object.

### Errors {#list-envelopes-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl "https://sign.codevibe.in/api/v1/envelopes?status=sent,in_progress" \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/envelopes?status=sent,in_progress', {
  headers: {
    Authorization: `Bearer ${process.env.SIGN_API_KEY}`,
  },
});
console.log(response.status, await response.json());
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/envelopes?status=sent,in_progress",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/envelopes?status=sent,in_progress", nil)
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

<ApiTryIt operation="listEnvelopes" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "envelopes": [
    {
      "id": "string",
      "title": "string",
      "status": "draft",
      "createdAt": "2026-03-02T09:14:31.000Z",
      "sentAt": "2026-03-02T09:14:31.000Z",
      "completedAt": "2026-03-02T09:14:31.000Z",
      "expiresAt": "2026-03-02T09:14:31.000Z",
      "metadata": {},
      "documents": [
        {
          "id": "string",
          "name": "string",
          "pageCount": 1
        }
      ],
      "recipients": [
        {
          "id": "string",
          "name": "string",
          "email": "string",
          "role": "signer",
          "status": "pending",
          "actedAt": "2026-03-02T09:14:31.000Z",
          "declineReason": "string"
        }
      ]
    }
  ],
  "nextCursor": "string"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="create-envelope">
<div class="api-op__main">

## Create an envelope {#create-envelope}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes</code></p>

Creates a draft with its documents, recipients and fields, and sends it at once when
`send` is `true`. Send the PDFs either as base64 in JSON, or as a multipart upload with
the envelope JSON in a form field named `envelope` and the files as `documents`.

The example carries a real one-page PDF, so it works as it is against a sandbox.

Each PDF is checked: at most 20 MB by default, at most 20 per envelope, and it must
open as a PDF. Field boxes are in PDF points from the top-left corner of the page and
must fit on it.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Headers {#create-envelope-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#create-envelope-body}

Send it as `application/json` or `multipart/form-data`.

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string</span></p>

Shown to recipients in the invitation and on the signing page.

<p class="api-field__meta">1 to 5000 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">changeNote</code> <span class="api-field__type">string</span></p>

For a revised envelope: what changed, shown to recipients as "What changed: …" in
the invitation and on the signing page. Send null or an empty string to clear it.

<p class="api-field__meta">At most 2000 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">routing</code> <span class="api-field__type">string</span></p>

`sequential` goes by `order`, lowest first (equal orders sign together); `parallel` invites everyone at once.

<p class="api-field__meta">One of <code>sequential</code> <code>parallel</code><span aria-hidden="true"> · </span>Default <code>sequential</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">reminders</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>reminders</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">firstAfterDays</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

Days after the invitation for the first reminder; 0 turns reminders off.

<p class="api-field__meta">0 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">everyDays</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">max</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

Most reminders per recipient.

<p class="api-field__meta">0 to 50</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">expiresAt</code> <span class="api-field__type">string (date-time)</span></p>

When the envelope expires; must be in the future.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">expiresInDays</code> <span class="api-field__type">integer</span></p>

Used when `expiresAt` is not set.

<p class="api-field__meta">Default <code>30</code><span aria-hidden="true"> · </span>1 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">metadata</code> <span class="api-field__type">map</span></p>

Your own data, for example an employee id. Echoed in webhooks.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">send</code> <span class="api-field__type">boolean</span></p>

Send at once instead of keeping a draft.

<p class="api-field__meta">Default <code>false</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">documents</code> <span class="api-field__type">array of objects</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 20 items</p>

<details class="api-field__children">
<summary>Attributes of <code>documents</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">key</code> <span class="api-field__type">string</span></p>

How fields refer to this document in the same request. Default its position, `"0"`.

<p class="api-field__meta">At most 100 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">content</code> <span class="api-field__type">string (base64)</span> <span class="api-field__required">Required</span></p>

The PDF file as base64.

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipients</code> <span class="api-field__type">array of objects</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 50 items</p>

<details class="api-field__children">
<summary>Attributes of <code>recipients</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">key</code> <span class="api-field__type">string</span></p>

How fields refer to this recipient in the same request. Default its position, `"0"`.

<p class="api-field__meta">At most 100 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

On `PATCH`, the id of an existing recipient to keep.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">email</code> <span class="api-field__type">string (email)</span></p>

<p class="api-field__meta">At most 254 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">phone</code> <span class="api-field__type">string</span></p>

International format, like `+919812345678`.

<p class="api-field__meta">Matches <code>^\+[1-9]\d{6,14}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">role</code> <span class="api-field__type">string</span></p>

Signers fill fields, approvers approve without fields, viewers get a copy.

<p class="api-field__meta">One of <code>signer</code> <code>approver</code> <code>viewer</code><span aria-hidden="true"> · </span>Default <code>signer</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">auth</code> <span class="api-field__type">string</span></p>

How the recipient proves who they are. `email_otp`, the default, asks for the link and a code sent by email; `email_link` needs only the link.

<p class="api-field__meta">One of <code>email_link</code> <code>email_otp</code> <code>sms_otp</code> <code>aadhaar</code><span aria-hidden="true"> · </span>Default <code>email_otp</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">order</code> <span class="api-field__type">integer</span></p>

Signing order in sequential routing. Default the position in the list, from 1.

<p class="api-field__meta">1 to 1000</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">fields</code> <span class="api-field__type">array of objects</span></p>

<p class="api-field__meta">At most 500 items</p>

<details class="api-field__children">
<summary>Attributes of <code>fields</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipient</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The recipient's `key` (or `id` on `PATCH`).

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">document</code> <span class="api-field__type">string</span></p>

The document's `key` or `id`. Optional when the envelope has one document.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

A recipient with `auth: aadhaar` has no fields: the eSign provider places the signature
where its own workflow says, and signs the document as the sender approved it, with
the values of the signers before them. `signature`, `initials` and `aadhaar` fields
given to such a signer are dropped when the envelope is sent, so older requests still
work; any other field for them is refused with `VALIDATION`. `aadhaar`, the Aadhaar
eSign box, is read on envelopes sent while it marked where the signer signs; it takes
no value, and only an Aadhaar eSign signer may have one.

<p class="api-field__meta">One of <code>signature</code> <code>initials</code> <code>date_signed</code> <code>name</code> <code>text</code> <code>checkbox</code> <code>aadhaar</code><span aria-hidden="true"> · </span>Default <code>signature</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">page</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

Zero-based page index.

<p class="api-field__meta">0 to 10000</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">y</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">width</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">height</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">rect</code> <span class="api-field__type">object</span></p>

A box in PDF points, measured from the top-left corner of the page.

<details class="api-field__children">
<summary>Attributes of <code>rect</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">y</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">width</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">height</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 1</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">required</code> <span class="api-field__type">boolean</span></p>

<p class="api-field__meta">Default <code>true</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">label</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">At most 200 characters</p>

</div>

</div>

</details>

</div>

</div>

### Returns {#create-envelope-returns}

**201 Created**. The envelope, as a draft or already sent. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#create-envelope-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 413 | `DOCUMENT_TOO_LARGE`: a PDF or the whole request is over the limit (`details.maxBytes`). |
| 422 | `DOCUMENT_INVALID`: a file is not a readable PDF. `PDF_ALREADY_SIGNED`: a file already carries digital signatures; upload the unsigned original. `REQUIRED_FIELDS_MISSING`: required fields were left empty. `INVALID_FIELD_VALUE`: a value does not suit its field (PNG, date, length). |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |
| 500 | `INTERNAL` or `SEAL_FAILED`. Safe to retry with the same `Idempotency-Key`. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/envelopes \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "title": "Offer letter",
  "message": "Please sign by Friday.",
  "send": true,
  "routing": "sequential",
  "documents": [
    {
      "key": "offer",
      "name": "offer.pdf",
      "content": "'"$(base64 < offer.pdf | tr -d '\n')"'"
    }
  ],
  "recipients": [
    {
      "key": "asha",
      "name": "Asha Rao",
      "email": "asha@example.com",
      "auth": "email_otp"
    },
    {
      "key": "ravi",
      "name": "Ravi Kumar",
      "email": "ravi@example.com"
    },
    {
      "key": "hr",
      "name": "HR Team",
      "email": "hr@example.com",
      "role": "viewer"
    }
  ],
  "fields": [
    {
      "recipient": "asha",
      "document": "offer",
      "type": "signature",
      "page": 0,
      "x": 72,
      "y": 640,
      "width": 180,
      "height": 48
    },
    {
      "recipient": "ravi",
      "type": "signature",
      "page": 0,
      "x": 320,
      "y": 640,
      "width": 180,
      "height": 48
    }
  ],
  "metadata": {
    "employeeId": "E-1042"
  }
}'
```

```ts check [Node.js]
import { readFile } from 'node:fs/promises';
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.create({
  title: 'Offer letter',
  message: 'Please sign by Friday.',
  send: true,
  routing: 'sequential',
  documents: [
    {
      key: 'offer',
      name: 'offer.pdf',
      content: await readFile('offer.pdf'),
    },
  ],
  recipients: [
    {
      key: 'asha',
      name: 'Asha Rao',
      email: 'asha@example.com',
      auth: 'email_otp',
    },
    {
      key: 'ravi',
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
    },
    {
      key: 'hr',
      name: 'HR Team',
      email: 'hr@example.com',
      role: 'viewer',
    },
  ],
  fields: [
    {
      recipient: 'asha',
      document: 'offer',
      type: 'signature',
      page: 0,
      x: 72,
      y: 640,
      width: 180,
      height: 48,
    },
    {
      recipient: 'ravi',
      type: 'signature',
      page: 0,
      x: 320,
      y: 640,
      width: 180,
      height: 48,
    },
  ],
  metadata: {
    employeeId: 'E-1042',
  },
});

console.log(envelope.id, envelope.status);
```

```python [Python]
import os
import base64

import requests

def b64(path):
    with open(path, "rb") as file:
        return base64.b64encode(file.read()).decode()

response = requests.post(
    "https://sign.codevibe.in/api/v1/envelopes",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "title": "Offer letter",
        "message": "Please sign by Friday.",
        "send": True,
        "routing": "sequential",
        "documents": [
            {
                "key": "offer",
                "name": "offer.pdf",
                "content": b64("offer.pdf"),
            },
        ],
        "recipients": [
            {
                "key": "asha",
                "name": "Asha Rao",
                "email": "asha@example.com",
                "auth": "email_otp",
            },
            {
                "key": "ravi",
                "name": "Ravi Kumar",
                "email": "ravi@example.com",
            },
            {
                "key": "hr",
                "name": "HR Team",
                "email": "hr@example.com",
                "role": "viewer",
            },
        ],
        "fields": [
            {
                "recipient": "asha",
                "document": "offer",
                "type": "signature",
                "page": 0,
                "x": 72,
                "y": 640,
                "width": 180,
                "height": 48,
            },
            {
                "recipient": "ravi",
                "type": "signature",
                "page": 0,
                "x": 320,
                "y": 640,
                "width": 180,
                "height": 48,
            },
        ],
        "metadata": {
            "employeeId": "E-1042",
        },
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
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func b64(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	return base64.StdEncoding.EncodeToString(data)
}

func main() {
	payload, err := json.Marshal(map[string]any{
		"title": "Offer letter",
		"message": "Please sign by Friday.",
		"send": true,
		"routing": "sequential",
		"documents": []any{
			map[string]any{
				"key": "offer",
				"name": "offer.pdf",
				"content": b64("offer.pdf"),
			},
		},
		"recipients": []any{
			map[string]any{
				"key": "asha",
				"name": "Asha Rao",
				"email": "asha@example.com",
				"auth": "email_otp",
			},
			map[string]any{
				"key": "ravi",
				"name": "Ravi Kumar",
				"email": "ravi@example.com",
			},
			map[string]any{
				"key": "hr",
				"name": "HR Team",
				"email": "hr@example.com",
				"role": "viewer",
			},
		},
		"fields": []any{
			map[string]any{
				"recipient": "asha",
				"document": "offer",
				"type": "signature",
				"page": 0,
				"x": 72,
				"y": 640,
				"width": 180,
				"height": 48,
			},
			map[string]any{
				"recipient": "ravi",
				"type": "signature",
				"page": 0,
				"x": 320,
				"y": 640,
				"width": 180,
				"height": 48,
			},
		},
		"metadata": map[string]any{
			"employeeId": "E-1042",
		},
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/envelopes", bytes.NewReader(payload))
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

<ApiTryIt operation="createEnvelope" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [201 Created]
{
  "id": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
  "title": "Offer letter",
  "message": "Please sign by Friday.",
  "status": "sent",
  "routing": "sequential",
  "documents": [
    {
      "id": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "name": "offer.pdf",
      "sha256": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
      "pageCount": 1,
      "pageSizes": [
        {
          "width": 595.28,
          "height": 841.89
        }
      ]
    }
  ],
  "recipients": [
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
  ],
  "fields": [
    {
      "id": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "recipientId": "c4a1d9e2-7f3b-4c8d-a6e5-0b9f2d1c7e83",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 640,
        "width": 180,
        "height": 48
      },
      "required": true
    }
  ],
  "values": [],
  "reminders": {
    "firstAfterDays": 2,
    "everyDays": 2,
    "max": 3
  },
  "expiresAt": "2026-04-01T09:00:00.000Z",
  "createdAt": "2026-03-02T09:00:00.000Z",
  "sentAt": "2026-03-02T09:00:00.000Z",
  "metadata": {
    "employeeId": "E-1042"
  },
  "auditHead": "3b5f0c4d6e1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-envelope">
<div class="api-op__main">

## Get an envelope {#get-envelope}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}</code></p>

The envelope with its documents, recipients, fields and the values entered so far.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#get-envelope-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Returns {#get-envelope-returns}

**200 OK**. The envelope. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

### Errors {#get-envelope-errors}

| Status | When |
| ------ | ---- |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37 \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.get('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37');

console.log(envelope.status, envelope.recipients);
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37", nil)
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

<ApiTryIt operation="getEnvelope" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "id": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
  "title": "Offer letter",
  "message": "Please sign by Friday.",
  "status": "sent",
  "routing": "sequential",
  "documents": [
    {
      "id": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "name": "offer.pdf",
      "sha256": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
      "pageCount": 1,
      "pageSizes": [
        {
          "width": 595.28,
          "height": 841.89
        }
      ]
    }
  ],
  "recipients": [
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
  ],
  "fields": [
    {
      "id": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "recipientId": "c4a1d9e2-7f3b-4c8d-a6e5-0b9f2d1c7e83",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 640,
        "width": 180,
        "height": 48
      },
      "required": true
    }
  ],
  "values": [],
  "reminders": {
    "firstAfterDays": 2,
    "everyDays": 2,
    "max": 3
  },
  "expiresAt": "2026-04-01T09:00:00.000Z",
  "createdAt": "2026-03-02T09:00:00.000Z",
  "sentAt": "2026-03-02T09:00:00.000Z",
  "metadata": {
    "employeeId": "E-1042"
  },
  "auditHead": "3b5f0c4d6e1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="update-envelope">
<div class="api-op__main">

## Change a draft {#update-envelope}

<p class="api-route"><span class="api-method" data-method="patch">PATCH</span><code>/v1/envelopes/{id}</code></p>

Changes a draft envelope. Only the properties you send change. `recipients` and
`fields`, when sent, replace the whole list: pass a recipient's `id` to keep it (its
signing order and details are updated), leave it out to remove it. Fields name their
recipient by `key` or `id` and their document by `id` or position (`"0"`).
Documents cannot be changed; create a new envelope instead. Send `"message": null`
to remove the message.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#update-envelope-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Request body {#update-envelope-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">1 to 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string or null</span></p>

<p class="api-field__meta">At most 5000 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">changeNote</code> <span class="api-field__type">string</span></p>

For a revised envelope: what changed, shown to recipients as "What changed: …" in
the invitation and on the signing page. Send null or an empty string to clear it.

<p class="api-field__meta">At most 2000 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">routing</code> <span class="api-field__type">string</span></p>

`sequential` goes by `order`, lowest first (equal orders sign together); `parallel` invites everyone at once.

<p class="api-field__meta">One of <code>sequential</code> <code>parallel</code><span aria-hidden="true"> · </span>Default <code>sequential</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">reminders</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>reminders</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">firstAfterDays</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

Days after the invitation for the first reminder; 0 turns reminders off.

<p class="api-field__meta">0 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">everyDays</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">max</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

Most reminders per recipient.

<p class="api-field__meta">0 to 50</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">expiresAt</code> <span class="api-field__type">string (date-time)</span></p>

When the envelope expires; must be in the future.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">expiresInDays</code> <span class="api-field__type">integer</span></p>

Used when `expiresAt` is not set.

<p class="api-field__meta">Default <code>30</code><span aria-hidden="true"> · </span>1 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">metadata</code> <span class="api-field__type">map</span></p>

Your own data, for example an employee id. Echoed in webhooks.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipients</code> <span class="api-field__type">array of objects</span></p>

Replaces the recipients. Include `id` to keep an existing one.

<p class="api-field__meta">1 to 50 items</p>

<details class="api-field__children">
<summary>Attributes of <code>recipients</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">key</code> <span class="api-field__type">string</span></p>

How fields refer to this recipient in the same request. Default its position, `"0"`.

<p class="api-field__meta">At most 100 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

On `PATCH`, the id of an existing recipient to keep.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">1 to 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">email</code> <span class="api-field__type">string (email)</span></p>

<p class="api-field__meta">At most 254 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">phone</code> <span class="api-field__type">string</span></p>

International format, like `+919812345678`.

<p class="api-field__meta">Matches <code>^\+[1-9]\d{6,14}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">role</code> <span class="api-field__type">string</span></p>

Signers fill fields, approvers approve without fields, viewers get a copy.

<p class="api-field__meta">One of <code>signer</code> <code>approver</code> <code>viewer</code><span aria-hidden="true"> · </span>Default <code>signer</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">auth</code> <span class="api-field__type">string</span></p>

How the recipient proves who they are. `email_otp`, the default, asks for the link and a code sent by email; `email_link` needs only the link.

<p class="api-field__meta">One of <code>email_link</code> <code>email_otp</code> <code>sms_otp</code> <code>aadhaar</code><span aria-hidden="true"> · </span>Default <code>email_otp</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">order</code> <span class="api-field__type">integer</span></p>

Signing order in sequential routing. Default the position in the list, from 1.

<p class="api-field__meta">1 to 1000</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">fields</code> <span class="api-field__type">array of objects</span></p>

Replaces all fields.

<p class="api-field__meta">At most 500 items</p>

<details class="api-field__children">
<summary>Attributes of <code>fields</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipient</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The recipient's `key` (or `id` on `PATCH`).

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">document</code> <span class="api-field__type">string</span></p>

The document's `key` or `id`. Optional when the envelope has one document.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

A recipient with `auth: aadhaar` has no fields: the eSign provider places the signature
where its own workflow says, and signs the document as the sender approved it, with
the values of the signers before them. `signature`, `initials` and `aadhaar` fields
given to such a signer are dropped when the envelope is sent, so older requests still
work; any other field for them is refused with `VALIDATION`. `aadhaar`, the Aadhaar
eSign box, is read on envelopes sent while it marked where the signer signs; it takes
no value, and only an Aadhaar eSign signer may have one.

<p class="api-field__meta">One of <code>signature</code> <code>initials</code> <code>date_signed</code> <code>name</code> <code>text</code> <code>checkbox</code> <code>aadhaar</code><span aria-hidden="true"> · </span>Default <code>signature</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">page</code> <span class="api-field__type">integer</span> <span class="api-field__required">Required</span></p>

Zero-based page index.

<p class="api-field__meta">0 to 10000</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">y</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">width</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">height</code> <span class="api-field__type">number</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">rect</code> <span class="api-field__type">object</span></p>

A box in PDF points, measured from the top-left corner of the page.

<details class="api-field__children">
<summary>Attributes of <code>rect</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">x</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">y</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 0</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">width</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">height</code> <span class="api-field__type">number</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At least 1</p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">required</code> <span class="api-field__type">boolean</span></p>

<p class="api-field__meta">Default <code>true</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">label</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">At most 200 characters</p>

</div>

</div>

</details>

</div>

</div>

### Returns {#update-envelope-returns}

**200 OK**. The changed draft. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

### Errors {#update-envelope-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X PATCH https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37 \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "title": "Offer letter (revised)",
  "expiresInDays": 14
}'
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.update('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37', {
  title: 'Offer letter (revised)',
  expiresInDays: 14,
});
```

```python [Python]
import os

import requests

response = requests.patch(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
    },
    json={
        "title": "Offer letter (revised)",
        "expiresInDays": 14,
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
		"title": "Offer letter (revised)",
		"expiresInDays": 14,
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("PATCH", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37", bytes.NewReader(payload))
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

<ApiTryIt operation="updateEnvelope" />

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
      "lastRemindedAt": "2026-03-02T09:14:31.000Z",
      "esign": {
        "provider": "leegality",
        "status": "pending",
        "signerName": "string",
        "signedAt": "2026-03-02T09:14:31.000Z",
        "ref": "string",
        "sandbox": true
      }
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

<section class="api-op" aria-labelledby="send-envelope">
<div class="api-op__main">

## Send a draft {#send-envelope}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/send</code></p>

Sends the draft. In sequential routing the recipients with the lowest `order` get their
signing links; in parallel routing everyone does. Viewers get a copy once it is complete.
The envelope needs at least one signer or approver, and every signer needs a signature
field.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#send-envelope-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Headers {#send-envelope-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Returns {#send-envelope-returns}

**200 OK**. The sent envelope. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#send-envelope-errors}

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
curl -X POST https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/send \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.send('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37');
```

```python [Python]
import os

import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/send",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
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
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/send", nil)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SIGN_API_KEY"))
	req.Header.Set("Idempotency-Key", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")
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

<ApiTryIt operation="sendEnvelope" />

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
      "lastRemindedAt": "2026-03-02T09:14:31.000Z",
      "esign": {
        "provider": "leegality",
        "status": "pending",
        "signerName": "string",
        "signedAt": "2026-03-02T09:14:31.000Z",
        "ref": "string",
        "sandbox": true
      }
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

<section class="api-op" aria-labelledby="void-envelope">
<div class="api-op__main">

## Withdraw an envelope {#void-envelope}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/void</code></p>

Withdraws a sent envelope that is not yet final. Signing links stop working and
recipients already invited are told it was withdrawn.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#void-envelope-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Headers {#void-envelope-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#void-envelope-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">reason</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

Shown to recipients and kept in the audit log.

<p class="api-field__meta">Not empty</p>

</div>

</div>

### Returns {#void-envelope-returns}

**200 OK**. The voided envelope. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#void-envelope-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/void \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "reason": "The offer was sent to the wrong address."
}'
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.envelopes.void('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37', 'The offer was sent to the wrong address.');
```

```python [Python]
import os

import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/void",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "reason": "The offer was sent to the wrong address.",
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
		"reason": "The offer was sent to the wrong address.",
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/void", bytes.NewReader(payload))
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

<ApiTryIt operation="voidEnvelope" />

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
      "lastRemindedAt": "2026-03-02T09:14:31.000Z",
      "esign": {
        "provider": "leegality",
        "status": "pending",
        "signerName": "string",
        "signedAt": "2026-03-02T09:14:31.000Z",
        "ref": "string",
        "sandbox": true
      }
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

<section class="api-op" aria-labelledby="recall-envelope">
<div class="api-op__main">

## Recall a sent envelope to edit it {#recall-envelope}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/recall</code></p>

Voids a sent or in-progress envelope with the reason "Recalled to correct" (and your
note), exactly like `void`: links stop and everyone already invited is told. Then
creates a new draft with the same documents (the original files), recipients, fields,
title, message and reminders, and an expiry of the same length from now. Signatures
already given are not carried over; everyone signs again. The old envelope records
`envelope.recalled` with `replacementId`; the draft's `envelope.created` has
`recalledFrom`.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#recall-envelope-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Request body {#recall-envelope-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">note</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">At most 900 characters</p>

</div>

</div>

### Returns {#recall-envelope-returns}

**201 Created**. The new draft and the recalled envelope. An `EnvelopeCopy` object.

### Errors {#recall-envelope-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recall \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "note": "The joining date was wrong."
}'
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const { draft, recalled } = await sign.envelopes.recall('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37', 'The joining date was wrong.');
```

```python [Python]
import os

import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recall",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
    },
    json={
        "note": "The joining date was wrong.",
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
		"note": "The joining date was wrong.",
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/recall", bytes.NewReader(payload))
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

<ApiTryIt operation="recallEnvelope" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [201 Created]
{
  "draft": {
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
        "lastRemindedAt": "2026-03-02T09:14:31.000Z",
        "esign": {
          "provider": "leegality",
          "status": "pending",
          "signerName": "string",
          "signedAt": "2026-03-02T09:14:31.000Z",
          "ref": "string",
          "sandbox": true
        }
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
  },
  "recalled": {
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
        "lastRemindedAt": "2026-03-02T09:14:31.000Z",
        "esign": {
          "provider": "leegality",
          "status": "pending",
          "signerName": "string",
          "signedAt": "2026-03-02T09:14:31.000Z",
          "ref": "string",
          "sandbox": true
        }
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
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="revise-envelope">
<div class="api-op__main">

## Revise a declined envelope {#revise-envelope}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/revise</code></p>

Copies a declined envelope to a new draft, like `recall`, so you can address the
decline and send again. The declined envelope stays declined and unchanged; it
records `envelope.revised` with `replacementId`, and the draft's `envelope.created`
has `revisedFrom`. Set `changeNote` on the draft to tell recipients what changed.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#revise-envelope-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Returns {#revise-envelope-returns}

**201 Created**. The new draft and the declined envelope. An object.

### Errors {#revise-envelope-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/revise \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const { draft, declined } = await sign.envelopes.revise('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37');
```

```python [Python]
import os

import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/revise",
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
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/revise", nil)
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

<ApiTryIt operation="reviseEnvelope" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [201 Created]
{
  "draft": {
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
        "lastRemindedAt": "2026-03-02T09:14:31.000Z",
        "esign": {
          "provider": "leegality",
          "status": "pending",
          "signerName": "string",
          "signedAt": "2026-03-02T09:14:31.000Z",
          "ref": "string",
          "sandbox": true
        }
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
  },
  "declined": {
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
        "lastRemindedAt": "2026-03-02T09:14:31.000Z",
        "esign": {
          "provider": "leegality",
          "status": "pending",
          "signerName": "string",
          "signedAt": "2026-03-02T09:14:31.000Z",
          "ref": "string",
          "sandbox": true
        }
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
}
```

:::

</div>

</div>
</section>
