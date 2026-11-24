---
title: "Signing"
description: "What the recipient's browser calls."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Signing

What the recipient's browser calls. `{token}` is the signing token from the link,
or the literal `link` to use the token held in the `cvsign_link` cookie.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#get-signing-receipt"><span class="api-method" data-method="get">GET</span><code>/v1/sign/receipt</code></a></li>
<li><a href="#get-receipt-document"><span class="api-method" data-method="get">GET</span><code>/v1/sign/receipt/documents/{docId}</code></a></li>
<li><a href="#get-emailed-copy"><span class="api-method" data-method="get">GET</span><code>/v1/sign/copy/{docId}</code></a></li>
<li><a href="#get-signing-session"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}</code></a></li>
<li><a href="#get-signing-document"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}/documents/{docId}</code></a></li>
<li><a href="#send-otp"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/otp</code></a></li>
<li><a href="#verify-otp"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/otp/verify</code></a></li>
<li><a href="#mark-viewed"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/view</code></a></li>
<li><a href="#submit-signature"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/submit</code></a></li>
<li><a href="#decline-signature"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/decline</code></a></li>
<li><a href="#get-esign-status"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}/esign</code></a></li>
<li><a href="#start-esign"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/esign</code></a></li>
<li><a href="#open-signing-link"><span class="api-method" data-method="get">GET</span><code>/sign/{token}</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="the-signing-session-object">
<div class="api-op__main">

## The signing session object {#the-signing-session-object}

### Attributes {#the-signing-session-object-attributes}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">workspaceId</code> <span class="api-field__type">string</span></p>

The workspace that sent the envelope, for its brand.

</div>
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
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string or null</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">changeNote</code> <span class="api-field__type">string or null</span></p>

What changed since a declined version, shown above the document.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string</span></p>

`completed`, `declined`, `expired` and `voided` are final.

<p class="api-field__meta">One of <code>draft</code> <code>sent</code> <code>in_progress</code> <code>completed</code> <code>declined</code> <code>expired</code> <code>voided</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">expiresAt</code> <span class="api-field__type">string (date-time) or null</span></p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipient</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>recipient</code></summary>

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
<p class="api-field__head"><code class="api-field__name">auth</code> <span class="api-field__type">string</span></p>

How the recipient proves who they are. `email_otp`, the default, asks for the link and a code sent by email; `email_link` needs only the link.

<p class="api-field__meta">One of <code>email_link</code> <code>email_otp</code> <code>sms_otp</code> <code>aadhaar</code></p>

</div>

</div>

</details>

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
<p class="api-field__head"><code class="api-field__name">pageCount</code> <span class="api-field__type">integer</span></p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">fields</code> <span class="api-field__type">array of objects</span></p>

This recipient's fields only.

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

A recipient with `auth: aadhaar` fills in nothing: the eSign provider signs the
document as the sender approved it, with the values of the signers before them. They
may have one `aadhaar` field, the Aadhaar seal position: it only says where the
provider draws its signature, takes no value, and nothing is drawn for it. Without it
the provider places the signature where its own setting says. A second `aadhaar`
field is refused with `VALIDATION`. `signature` and `initials` fields given to such a
signer are dropped when the envelope is sent, so older requests still work; any other
field for them is refused with `VALIDATION`. Only an Aadhaar eSign signer may have an
`aadhaar` field.

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

Values already entered in this recipient's fields.

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
<p class="api-field__head"><code class="api-field__name">otpRequired</code> <span class="api-field__type">boolean</span></p>

The recipient signs with a one-time code.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">authenticated</code> <span class="api-field__type">boolean</span></p>

A valid session came with this request.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">canAct</code> <span class="api-field__type">boolean</span></p>

It is this recipient's turn.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">timeZone</code> <span class="api-field__type">string</span></p>

IANA time zone the signing date is printed in on the document, for example `Asia/Kolkata`: the workspace's own, or the server's. `UTC` when none is set.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">esign</code> <span class="api-field__type">object</span></p>

Present only for a recipient who signs with Aadhaar eSign.

<details class="api-field__children">
<summary>Attributes of <code>esign</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">available</code> <span class="api-field__type">boolean</span></p>

The sender's workspace can start an Aadhaar eSign right now.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">provider</code> <span class="api-field__type">string or null</span></p>

The eSign provider, once the recipient has started.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">status</code> <span class="api-field__type">string or null</span></p>

Where the latest attempt stands; `null` before the first.

<p class="api-field__meta">One of <code>pending</code> <code>signed</code> <code>declined</code> <code>expired</code> <code>failed</code></p>

</div>

</div>

</details>

</div>

</div>

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Example">

::: code-group

```json [SignerView]
{
  "workspaceId": "string",
  "envelope": {
    "id": "string",
    "title": "string",
    "message": "string",
    "changeNote": "string",
    "status": "draft",
    "expiresAt": "2026-03-02T09:14:31.000Z"
  },
  "recipient": {
    "id": "string",
    "name": "string",
    "email": "string",
    "role": "signer",
    "status": "pending",
    "auth": "email_link"
  },
  "documents": [
    {
      "id": "string",
      "name": "string",
      "pageCount": 1
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
  "otpRequired": true,
  "authenticated": true,
  "canAct": true,
  "timeZone": "Asia/Kolkata",
  "esign": {
    "available": true,
    "provider": "leegality",
    "status": "pending"
  }
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-signing-receipt">
<div class="api-op__main">

## Follow the envelope after signing {#get-signing-receipt}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/sign/receipt</code></p>

For a recipient who has signed or approved. The submit call hands back a receipt, as
the `cvsign_receipt` cookie and the `X-Sign-Receipt` header, valid for 7 days. With it
the recipient can see where the envelope stands, how many people it is still waiting
for (not who), and which documents are sealed and ready to download. The signing link
itself stops working once the recipient has acted.

<p class="api-auth"><span class="api-auth__label">Auth</span> The <code>X-Sign-Receipt</code> header or the <code>cvsign_receipt</code> cookie.</p>

### Returns {#get-signing-receipt-returns}

**200 OK**. The receipt. A `SigningReceipt` object.

### Errors {#get-signing-receipt-errors}

| Status | When |
| ------ | ---- |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/sign/receipt \
  -H "X-Sign-Receipt: $SIGN_RECEIPT"
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/sign/receipt', {
  headers: {
    'X-Sign-Receipt': process.env.SIGN_RECEIPT!,
  },
});
console.log(response.status, await response.json());
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/sign/receipt",
    headers={
        "X-Sign-Receipt": os.environ["SIGN_RECEIPT"],
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/sign/receipt", nil)
	if err != nil {
		panic(err)
	}
	req.Header.Set("X-Sign-Receipt", os.Getenv("SIGN_RECEIPT"))
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

<ApiTryIt operation="getSigningReceipt" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "workspaceId": "string",
  "envelope": {
    "id": "string",
    "title": "string",
    "status": "draft",
    "completedAt": "2026-03-02T09:14:31.000Z"
  },
  "recipient": {
    "id": "string",
    "name": "string",
    "role": "signer",
    "status": "pending"
  },
  "waitingFor": 0,
  "documents": [
    {
      "id": "string",
      "name": "string",
      "sealed": true,
      "certificate": true,
      "certificateWithAuditTrail": true
    }
  ]
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-receipt-document">
<div class="api-op__main">

## Download your signed copy {#get-receipt-document}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/sign/receipt/documents/{docId}</code></p>

The sealed PDF, once everyone has acted and the seal is applied. Before that the
answer is `INVALID_STATE`; poll `GET /v1/sign/receipt` until the document's `sealed`
is `true`.

<p class="api-auth"><span class="api-auth__label">Auth</span> The <code>X-Sign-Receipt</code> header or the <code>cvsign_receipt</code> cookie.</p>

### Path parameters {#get-receipt-document-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">docId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The document id, from `documents[].id`.

</div>

</div>

### Query parameters {#get-receipt-document-query}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">file</code> <span class="api-field__type">string</span></p>

`certificate` for the signing certificate of a document whose `certificate` is `true` in the receipt, `audit-trail` for the envelope's audit trail as a PDF once it is complete. Leave out for the signed document.

<p class="api-field__meta">One of <code>certificate</code> <code>audit-trail</code></p>

</div>

</div>

### Returns {#get-receipt-document-returns}

**200 OK**. The PDF file. A string.

- `Content-Disposition`: `attachment; filename="<name>-original.pdf"` or `...-sealed.pdf`.

### Errors {#get-receipt-document-errors}

| Status | When |
| ------ | ---- |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/sign/receipt/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048 \
  -H "X-Sign-Receipt: $SIGN_RECEIPT" \
  -o document.pdf
```

```ts check [Node.js]
import { writeFile } from 'node:fs/promises';

const response = await fetch('https://sign.codevibe.in/api/v1/sign/receipt/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048', {
  headers: {
    'X-Sign-Receipt': process.env.SIGN_RECEIPT!,
  },
});
await writeFile('document.pdf', new Uint8Array(await response.arrayBuffer()));
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/sign/receipt/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
    headers={
        "X-Sign-Receipt": os.environ["SIGN_RECEIPT"],
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/sign/receipt/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048", nil)
	if err != nil {
		panic(err)
	}
	req.Header.Set("X-Sign-Receipt", os.Getenv("SIGN_RECEIPT"))
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

<ApiTryIt operation="getReceiptDocument" />

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

<section class="api-op" aria-labelledby="get-emailed-copy">
<div class="api-op__main">

## Download a signed copy from its email link {#get-emailed-copy}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/sign/copy/{docId}</code></p>

The link in a completed-copy email whose sealed files were not attached, because they
were too large or could not be read. It names one recipient of one completed
envelope and works for 30 days. Nothing else is needed to call it.

<p class="api-auth"><span class="api-auth__label">Auth</span> The link itself.</p>

### Path parameters {#get-emailed-copy-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">docId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The document id, from `documents[].id`.

</div>

</div>

### Query parameters {#get-emailed-copy-query}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">c</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signed value from the download link in the completed-copy email.

<p class="api-field__meta">At most 1024 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">file</code> <span class="api-field__type">string</span></p>

`certificate` for the signing certificate of a document whose `certificate` is `true` in the receipt, `audit-trail` for the envelope's audit trail as a PDF. Leave out for the signed document.

<p class="api-field__meta">One of <code>certificate</code> <code>audit-trail</code></p>

</div>

</div>

### Returns {#get-emailed-copy-returns}

**200 OK**. The PDF file. A string.

- `Content-Disposition`: `attachment; filename="<name>-original.pdf"` or `...-sealed.pdf`.

### Errors {#get-emailed-copy-errors}

| Status | When |
| ------ | ---- |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl "https://sign.codevibe.in/api/v1/sign/copy/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048?c=string" \
  -o document.pdf
```

```ts check [Node.js]
import { writeFile } from 'node:fs/promises';

const response = await fetch('https://sign.codevibe.in/api/v1/sign/copy/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048?c=string');
await writeFile('document.pdf', new Uint8Array(await response.arrayBuffer()));
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/sign/copy/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048?c=string",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/sign/copy/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048?c=string", nil)
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="getEmailedCopy" />

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

<section class="api-op" aria-labelledby="get-signing-session">
<div class="api-op__main">

## Open a signing session {#get-signing-session}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}</code></p>

The envelope basics, the recipient, their own fields and values, and what they still
need to do. For recipients who sign with a one-time code, `otpRequired` is `true` and
`authenticated` says whether a valid session came with the request. Until it is
`true` the answer holds only what the invitation email already said: `message` and
`changeNote` are `null`, `documents`, `fields` and `values` are empty and the email
address is masked. Read it again after `otp/verify`. `canAct` is `false` while it is
someone else's turn.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path, the <code>X-Sign-Session</code> header, the <code>cvsign_session</code> cookie or the <code>cvsign_link</code> cookie.</p>

### Path parameters {#get-signing-session-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Returns {#get-signing-session-returns}

**200 OK**. The signer's view. A [signing session object](/http-api/reference/signing#the-signing-session-object).

### Errors {#get-signing-session-errors}

| Status | When |
| ------ | ---- |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw
```

```ts check [Node.js]
import { createSignerClient } from '@codevibe_technology/sign-client';

// The token is the last part of the recipient's signing link.
const signer = createSignerClient({
  baseUrl: 'https://sign.codevibe.in/api',
  token: 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
});

const session = await signer.session();
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw",
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
)

func main() {
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw", nil)
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="getSigningSession" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "workspaceId": "string",
  "envelope": {
    "id": "string",
    "title": "string",
    "message": "string",
    "changeNote": "string",
    "status": "draft",
    "expiresAt": "2026-03-02T09:14:31.000Z"
  },
  "recipient": {
    "id": "string",
    "name": "string",
    "email": "string",
    "role": "signer",
    "status": "pending",
    "auth": "email_link"
  },
  "documents": [
    {
      "id": "string",
      "name": "string",
      "pageCount": 1
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
  "otpRequired": true,
  "authenticated": true,
  "canAct": true,
  "timeZone": "Asia/Kolkata",
  "esign": {
    "available": true,
    "provider": "leegality",
    "status": "pending"
  }
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-signing-document">
<div class="api-op__main">

## Download the original PDF {#get-signing-document}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}/documents/{docId}</code></p>

The document to sign. Recipients who sign with a one-time code must verify it first.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path, the <code>X-Sign-Session</code> header, the <code>cvsign_session</code> cookie or the <code>cvsign_link</code> cookie.</p>

### Path parameters {#get-signing-document-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">docId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The document id, from `documents[].id`.

</div>

</div>

### Returns {#get-signing-document-returns}

**200 OK**. The PDF file. A string.

- `Content-Disposition`: `attachment; filename="<name>-original.pdf"` or `...-sealed.pdf`.

### Errors {#get-signing-document-errors}

| Status | When |
| ------ | ---- |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048 \
  -o document.pdf
```

```ts check [Node.js]
import { createSignerClient } from '@codevibe_technology/sign-client';

// The token is the last part of the recipient's signing link.
const signer = createSignerClient({
  baseUrl: 'https://sign.codevibe.in/api',
  token: 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
});

const pdf = await signer.document('1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048');
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048", nil)
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="getSigningDocument" />

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

<section class="api-op" aria-labelledby="send-otp">
<div class="api-op__main">

## Send a one-time code {#send-otp}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/otp</code></p>

Sends a new six-digit code by email or SMS, valid for 10 minutes, and replaces the
previous one. At most 5 codes per 15 minutes and 10 per recipient over the envelope's
life; after that the answer is `OTP_LOCKED` with `details.reason: "too_many_codes"`
and the sender has to send the envelope again.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path or the <code>cvsign_link</code> cookie.</p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#send-otp-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Headers {#send-otp-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Returns {#send-otp-returns}

**200 OK**. The code is on its way. An object.

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#send-otp-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 423 | `OTP_LOCKED`: too many wrong guesses, or too many codes for this envelope (`details.reason`). |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |
| 500 | `INTERNAL` or `SEAL_FAILED`. Safe to retry with the same `Idempotency-Key`. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/otp \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
```

```ts check [Node.js]
import { createSignerClient } from '@codevibe_technology/sign-client';

// The token is the last part of the recipient's signing link.
const signer = createSignerClient({
  baseUrl: 'https://sign.codevibe.in/api',
  token: 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
});

const { sentTo } = await signer.requestOtp();
```

```python [Python]
import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/otp",
    headers={
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
)

func main() {
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/otp", nil)
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="sendOtp" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "sentTo": "a***@example.com",
  "expiresAt": "2026-03-02T09:10:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="verify-otp">
<div class="api-op__main">

## Verify the one-time code {#verify-otp}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/otp/verify</code></p>

Checks the code. On success the server sets a 30-minute `cvsign_session` cookie
(HttpOnly, SameSite=Strict, path `/v1/sign`) and also returns the session, which you
can send as `X-Sign-Session` instead. Five wrong guesses lock the code (`OTP_LOCKED`);
ask for a new one.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path or the <code>cvsign_link</code> cookie.</p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#verify-otp-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Headers {#verify-otp-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#verify-otp-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">code</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">Matches <code>^\s*\d{6}\s*$</code></p>

</div>

</div>

### Returns {#verify-otp-returns}

**200 OK**. The code is correct. An object.

- `Set-Cookie`: `cvsign_session=<session>; Path=/v1/sign; HttpOnly; SameSite=Strict; Max-Age=1800`
- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#verify-otp-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 423 | `OTP_LOCKED`: too many wrong guesses, or too many codes for this envelope (`details.reason`). |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/otp/verify \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "code": "482913"
}'
```

```ts check [Node.js]
import { createSignerClient } from '@codevibe_technology/sign-client';

// The token is the last part of the recipient's signing link.
const signer = createSignerClient({
  baseUrl: 'https://sign.codevibe.in/api',
  token: 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
});

await signer.verifyOtp('482913');
```

```python [Python]
import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/otp/verify",
    headers={
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "code": "482913",
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
)

func main() {
	payload, err := json.Marshal(map[string]any{
		"code": "482913",
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/otp/verify", bytes.NewReader(payload))
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="verifyOtp" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "sessionToken": "string",
  "expiresAt": "2026-03-02T09:14:31.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="mark-viewed">
<div class="api-op__main">

## Record that the document was opened {#mark-viewed}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/view</code></p>

Marks the recipient as having viewed the document. Call it when the page shows the
document, not when the link is opened, so mail scanners that follow links change
nothing.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path, the <code>X-Sign-Session</code> header, the <code>cvsign_session</code> cookie or the <code>cvsign_link</code> cookie.</p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#mark-viewed-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Headers {#mark-viewed-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Returns {#mark-viewed-returns}

**200 OK**. Where the envelope and this recipient stand now. A `SignerActionResult` object.

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#mark-viewed-errors}

| Status | When |
| ------ | ---- |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/view \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
```

```ts check [Node.js]
import { createSignerClient } from '@codevibe_technology/sign-client';

// The token is the last part of the recipient's signing link.
const signer = createSignerClient({
  baseUrl: 'https://sign.codevibe.in/api',
  token: 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
});

await signer.view();
```

```python [Python]
import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/view",
    headers={
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
)

func main() {
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/view", nil)
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="markViewed" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "envelopeStatus": "in_progress",
  "recipientStatus": "signed"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="submit-signature">
<div class="api-op__main">

## Sign or approve {#submit-signature}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/submit</code></p>

Submits the recipient's field values and their consent to sign electronically. Signers
must fill every required field; approvers send an empty `values` list. When the last
required recipient acts, the envelope completes and the sealed PDF is produced.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path, the <code>X-Sign-Session</code> header, the <code>cvsign_session</code> cookie or the <code>cvsign_link</code> cookie.</p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#submit-signature-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Headers {#submit-signature-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#submit-signature-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">consent</code> <span class="api-field__type">boolean</span> <span class="api-field__required">Required</span></p>

The signer agrees to sign electronically.

<p class="api-field__meta">Always <code>true</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">values</code> <span class="api-field__type">array of objects</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At most 500 items</p>

<details class="api-field__children">
<summary>Attributes of <code>values</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">fieldId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">value</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

Signature and initials: PNG as base64. Text and name: the text. Checkbox: `true` or
`false`. Date: an ISO date. An `aadhaar` box takes no value; leave it out.

</div>

</div>

</details>

</div>

</div>

### Returns {#submit-signature-returns}

**200 OK**. Where the envelope and this recipient stand now, with a receipt for following the
envelope and downloading the signed copy (`GET /v1/sign/receipt`). A `SignerActionResult` object.

- `X-Sign-Receipt`: The receipt. Send it back as `X-Sign-Receipt`.
- `Set-Cookie`: `cvsign_receipt=<receipt>; Path=/v1/sign; HttpOnly; SameSite=Strict; Max-Age=604800`
- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#submit-signature-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 403 | `FIELD_NOT_YOURS`: a value names a field that belongs to another recipient. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 410 | `ENVELOPE_EXPIRED`: the envelope is past its expiry. |
| 422 | `DOCUMENT_INVALID`: a file is not a readable PDF. `PDF_ALREADY_SIGNED`: a file already carries digital signatures; upload the unsigned original. `REQUIRED_FIELDS_MISSING`: required fields were left empty. `INVALID_FIELD_VALUE`: a value does not suit its field (PNG, date, length). |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/submit \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "consent": true,
  "values": [
    {
      "fieldId": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
      "value": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    }
  ]
}'
```

```ts check [Node.js]
import { createSignerClient } from '@codevibe_technology/sign-client';

// The token is the last part of the recipient's signing link.
const signer = createSignerClient({
  baseUrl: 'https://sign.codevibe.in/api',
  token: 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
});

// Call only after the signer has agreed: the client sends consent: true.
const result = await signer.submit([
  {
    fieldId: 'e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94',
    value: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  },
]);
```

```python [Python]
import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/submit",
    headers={
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "consent": True,
        "values": [
            {
                "fieldId": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
                "value": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            },
        ],
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
)

func main() {
	payload, err := json.Marshal(map[string]any{
		"consent": true,
		"values": []any{
			map[string]any{
				"fieldId": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
				"value": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
			},
		},
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/submit", bytes.NewReader(payload))
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="submitSignature" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "envelopeStatus": "in_progress",
  "recipientStatus": "signed"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="decline-signature">
<div class="api-op__main">

## Decline {#decline-signature}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/decline</code></p>

Declines to sign. The envelope becomes `declined` and everyone already invited is told.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path, the <code>X-Sign-Session</code> header, the <code>cvsign_session</code> cookie or the <code>cvsign_link</code> cookie.</p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#decline-signature-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Headers {#decline-signature-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#decline-signature-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">reason</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">Not empty</p>

</div>

</div>

### Returns {#decline-signature-returns}

**200 OK**. Where the envelope and this recipient stand now. A `SignerActionResult` object.

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#decline-signature-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/decline \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "reason": "The joining date is wrong."
}'
```

```ts check [Node.js]
import { createSignerClient } from '@codevibe_technology/sign-client';

// The token is the last part of the recipient's signing link.
const signer = createSignerClient({
  baseUrl: 'https://sign.codevibe.in/api',
  token: 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
});

const result = await signer.decline('The joining date is wrong.');
```

```python [Python]
import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/decline",
    headers={
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "reason": "The joining date is wrong.",
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
)

func main() {
	payload, err := json.Marshal(map[string]any{
		"reason": "The joining date is wrong.",
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/decline", bytes.NewReader(payload))
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="declineSignature" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "envelopeStatus": "in_progress",
  "recipientStatus": "signed"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-esign-status">
<div class="api-op__main">

## Follow an Aadhaar eSign {#get-esign-status}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}/esign</code></p>

Where the recipient's Aadhaar eSign stands. While it is `pending` the server also
asks the provider, at most once every few seconds, so the page the signer comes
back to moves on even when the provider's callback is late. Unlike the other signing
routes it still answers after the recipient has signed, and then hands out the
receipt for `GET /v1/sign/receipt`.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path or the <code>cvsign_link</code> cookie.</p>

### Path parameters {#get-esign-status-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Returns {#get-esign-status-returns}

**200 OK**. The latest attempt, or `none` before the first. An object.

- `X-Sign-Receipt`: The receipt, once `status` is `signed`. Send it back as `X-Sign-Receipt`.

### Errors {#get-esign-status-errors}

| Status | When |
| ------ | ---- |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign');
console.log(response.status, await response.json());
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign",
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
)

func main() {
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign", nil)
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="getEsignStatus" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "status": "pending",
  "signUrl": "https://sandbox.leegality.com/sign/2c0c9c1e-7f0a-4a55-9a53-0f0d5b8e6a11",
  "expiresAt": "2026-03-03T09:10:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="start-esign">
<div class="api-op__main">

## Start an Aadhaar eSign {#start-esign}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/esign</code></p>

For a recipient with `auth: aadhaar`, in place of `submit`. Takes the same body:
the recipient's consent and, as they have no fields, no values. The server sends the
document with the values of the signers before them drawn on it, and nothing else, to
the eSign provider and answers the provider's signing page; send the signer there.
The provider places the signature where its workflow says. The recipient becomes `signed` once the
provider reports the signature. Asking again while an attempt is open answers the
same page.

<p class="api-auth"><span class="api-auth__label">Auth</span> The signing token in the path or the <code>cvsign_link</code> cookie.</p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#start-esign-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the link (43 base64url characters), or `link` to use the
token in the `cvsign_link` cookie. Anything else is refused with `TOKEN_INVALID`.

<p class="api-field__meta">Matches <code>^([A-Za-z0-9_-]{43}|link)$</code></p>

</div>

</div>

### Headers {#start-esign-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#start-esign-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">consent</code> <span class="api-field__type">boolean</span> <span class="api-field__required">Required</span></p>

The signer agrees to sign electronically.

<p class="api-field__meta">Always <code>true</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">values</code> <span class="api-field__type">array of objects</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">At most 500 items</p>

<details class="api-field__children">
<summary>Attributes of <code>values</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">fieldId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">value</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

Signature and initials: PNG as base64. Text and name: the text. Checkbox: `true` or
`false`. Date: an ISO date. An `aadhaar` box takes no value; leave it out.

</div>

</div>

</details>

</div>

</div>

### Returns {#start-esign-returns}

**200 OK**. Where to send the signer. An object.

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#start-esign-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `TOKEN_INVALID`: the link is unknown, used, expired or withdrawn. `OTP_INVALID`: the code is wrong (`details.attemptsLeft`), or the session is missing (`details.otpRequired`). `OTP_EXPIRED`: the code timed out or none was sent. |
| 403 | `FIELD_NOT_YOURS`: a value names a field that belongs to another recipient. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 410 | `ENVELOPE_EXPIRED`: the envelope is past its expiry. |
| 413 | `DOCUMENT_TOO_LARGE`: a PDF or the whole request is over the limit (`details.maxBytes`). |
| 422 | `DOCUMENT_INVALID`: a file is not a readable PDF. `PDF_ALREADY_SIGNED`: a file already carries digital signatures; upload the unsigned original. `REQUIRED_FIELDS_MISSING`: required fields were left empty. `INVALID_FIELD_VALUE`: a value does not suit its field (PNG, date, length). |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |
| 502 | The eSign provider failed or could not be reached. Try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "consent": true,
  "values": [
    {
      "fieldId": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
      "value": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    }
  ]
}'
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign', {
  method: 'POST',
  headers: {
    'Idempotency-Key': '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    consent: true,
    values: [
      {
        fieldId: 'e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94',
        value: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      },
    ],
  }),
});
console.log(response.status, await response.json());
```

```python [Python]
import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign",
    headers={
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "consent": True,
        "values": [
            {
                "fieldId": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
                "value": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            },
        ],
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
)

func main() {
	payload, err := json.Marshal(map[string]any{
		"consent": true,
		"values": []any{
			map[string]any{
				"fieldId": "e9d2b7c1-4a6f-4e3b-8d5c-3f1a0b2c6d94",
				"value": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
			},
		},
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw/esign", bytes.NewReader(payload))
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="startEsign" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "signUrl": "https://sandbox.leegality.com/sign/2c0c9c1e-7f0a-4a55-9a53-0f0d5b8e6a11",
  "expiresAt": "2026-03-03T09:10:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="open-signing-link">
<div class="api-op__main">

## Open a signing link {#open-signing-link}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/sign/{token}</code></p>

Where signing links point. Stores the token in an HttpOnly, SameSite=Strict
`cvsign_link` cookie (path `/v1/sign`, at most 24 hours) and redirects to the signing
page, whose URL carries no token. The page then calls `/v1/sign/link/...` from the same
origin. An unknown or used token clears the cookie and redirects all the same, adding
`?state=` with the reason (`signed`, `completed`, `declined`, `voided`, `expired` or
`invalid`) and, when the envelope is known, `&w=<workspaceId>` so the page can explain
it in the sender's brand. This route only reads: opening a link does not mark the
document as viewed.

<p class="api-auth"><span class="api-auth__label">Auth</span> None. This route is public.</p>

### Path parameters {#open-signing-link-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">token</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The signing token from the email.

</div>

</div>

### Returns {#open-signing-link-returns}

**303 See Other**. Redirect to the signing page.

- `Location`: The signing page, without the token; for a dead link with `?state=`.
- `Set-Cookie`: `cvsign_link=<token>; Path=/v1/sign; HttpOnly; SameSite=Strict`

### Errors {#open-signing-link-errors}

| Status | When |
| ------ | ---- |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw \
  -i
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw', {
  redirect: 'manual',
});
console.log(response.status, response.headers.get('location'));
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw",
    allow_redirects=False,
    timeout=30,
)

print(response.status_code, response.headers["Location"])
```

```go [Go]
package main

import (
	"fmt"
	"net/http"
)

func main() {
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw", nil)
	if err != nil {
		panic(err)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	res, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	fmt.Println(res.Status, res.Header.Get("Location"))
}
```

:::

<ApiTryIt operation="openSigningLink" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```http [303 See Other]
HTTP/1.1 303 See Other
Location: /sign
```

:::

</div>

</div>
</section>
