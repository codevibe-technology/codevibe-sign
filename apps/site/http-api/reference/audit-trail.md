---
title: "Audit trail"
description: "The hash-chained audit log of an envelope and the signing certificate built from it."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Audit trail

The hash-chained audit log of an envelope and the signing certificate built from it.
Sender API key required.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#list-envelope-events"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/events</code></a></li>
<li><a href="#get-certificate"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/certificate</code></a></li>
<li><a href="#get-audit-trail-pdf"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/audit-trail</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="the-audit-event-object">
<div class="api-op__main">

## The audit event object {#the-audit-event-object}

### Attributes {#the-audit-event-object-attributes}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">seq</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">envelopeId</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">action</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>envelope.created</code> <code>envelope.updated</code> <code>envelope.sent</code> <code>envelope.completed</code> <code>envelope.declined</code> <code>envelope.expired</code> <code>envelope.voided</code> <code>recipient.notified</code> <code>recipient.reminded</code> <code>recipient.viewed</code> <code>recipient.authenticated</code> <code>recipient.signed</code> <code>recipient.approved</code> <code>recipient.declined</code> <code>recipient.link_shared</code> <code>recipient.corrected</code> <code>recipient.esign_started</code> <code>recipient.esign_failed</code> <code>envelope.recalled</code> <code>envelope.revised</code> <code>document.sealed</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">at</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipientId</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">context</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>context</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">ip</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">userAgent</code> <span class="api-field__type">string</span></p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">data</code> <span class="api-field__type">map</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">prevHash</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">hash</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>

</div>

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Example">

::: code-group

```json [AuditEvent]
{
  "seq": 1,
  "envelopeId": "string",
  "action": "envelope.created",
  "at": "2026-03-02T09:14:31.000Z",
  "recipientId": "string",
  "context": {
    "ip": "string",
    "userAgent": "string"
  },
  "data": {},
  "prevHash": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c",
  "hash": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="list-envelope-events">
<div class="api-op__main">

## Audit log {#list-envelope-events}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/events</code></p>

Every action on the envelope, oldest first, and whether the hash chain is intact: each
event's `hash` is `sha256(prevHash + canonical(event))` and the last one must equal the
envelope's `auditHead`.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#list-envelope-events-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Returns {#list-envelope-events-returns}

**200 OK**. The events and the chain check. An object.

### Errors {#list-envelope-events-errors}

| Status | When |
| ------ | ---- |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/events \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const { events, chainValid } = await sign.envelopes.events('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37');
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/events",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/events", nil)
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

<ApiTryIt operation="listEnvelopeEvents" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "chainValid": true,
  "events": [
    {
      "seq": 1,
      "envelopeId": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
      "action": "envelope.created",
      "at": "2026-03-02T09:00:00.000Z",
      "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "hash": "3b5f0c4d6e1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c"
    }
  ]
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-certificate">
<div class="api-op__main">

## Signing certificate {#get-certificate}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/certificate</code></p>

What the certificate page of the sealed PDF shows, as JSON: the hash of each document
before and after sealing, each recipient with the authentication they used and every
action they took, and the head of the audit chain.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#get-certificate-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Returns {#get-certificate-returns}

**200 OK**. The certificate. A `Certificate` object.

### Errors {#get-certificate-errors}

| Status | When |
| ------ | ---- |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/certificate \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const certificate = await sign.envelopes.certificate('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37');
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/certificate",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/certificate", nil)
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

<ApiTryIt operation="getCertificate" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "envelopeId": "string",
  "title": "string",
  "status": "draft",
  "completedAt": "2026-03-02T09:14:31.000Z",
  "auditHead": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c",
  "chainValid": true,
  "documents": [
    {
      "id": "string",
      "name": "string",
      "sha256": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c",
      "sealedSha256": "9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c9f2c"
    }
  ],
  "recipients": [
    {
      "id": "string",
      "name": "string",
      "email": "string",
      "phone": "string",
      "role": "signer",
      "auth": "email_link",
      "status": "pending",
      "actions": [
        {
          "action": "envelope.created",
          "at": "2026-03-02T09:14:31.000Z",
          "ip": "string",
          "userAgent": "string"
        }
      ]
    }
  ]
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-audit-trail-pdf">
<div class="api-op__main">

## Audit trail as a PDF {#get-audit-trail-pdf}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/audit-trail</code></p>

The envelope's audit trail as a PDF, the same file the completed-copy email carries:
the envelope, the SHA-256 of each document before and after signing, each recipient
with the method they used (an Aadhaar eSign names its provider), and every event with
its time in the workspace's time zone and UTC, who acted and the network address it
came from, then the head of the hash chain.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#get-audit-trail-pdf-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>

</div>

### Returns {#get-audit-trail-pdf-returns}

**200 OK**. The PDF file. A string.

- `Content-Disposition`: `attachment; filename="<name>-original.pdf"` or `...-sealed.pdf`.

### Errors {#get-audit-trail-pdf-errors}

| Status | When |
| ------ | ---- |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/audit-trail \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -o document.pdf
```

```ts check [Node.js]
import { writeFile } from 'node:fs/promises';

const response = await fetch('https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/audit-trail', {
  headers: {
    Authorization: `Bearer ${process.env.SIGN_API_KEY}`,
  },
});
await writeFile('document.pdf', new Uint8Array(await response.arrayBuffer()));
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/audit-trail",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
    },
    timeout=30,
)

response.raise_for_status()
with open("document.pdf", "wb") as file:
    file.write(response.content)
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/audit-trail", nil)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SIGN_API_KEY"))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	file, err := os.Create("document.pdf")
	if err != nil {
		panic(err)
	}
	defer file.Close()
	if _, err := io.Copy(file, res.Body); err != nil {
		panic(err)
	}
	fmt.Println(res.Status)
}
```

:::

<ApiTryIt operation="getAuditTrailPdf" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```text [200 OK]
Content-Type: application/pdf

%PDF-1.7 ... (the PDF bytes)
```

:::

</div>

</div>
</section>
