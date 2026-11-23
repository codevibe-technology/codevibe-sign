---
title: "Documents"
description: "The PDFs of an envelope: replace a draft's file, download the original or the sealed copy, and check the seal."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Documents

The PDFs of an envelope: replace a draft's file, download the original or the sealed
copy, and check the seal. Sender API key required.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#download-document"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/documents/{docId}</code></a></li>
<li><a href="#replace-document"><span class="api-method" data-method="put">PUT</span><code>/v1/envelopes/{id}/documents/{docId}</code></a></li>
<li><a href="#verify-document"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/documents/{docId}/verification</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="the-document-object">
<div class="api-op__main">

## The document object {#the-document-object}

### Attributes {#the-document-object-attributes}

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

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Example">

::: code-group

```json [Document]
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
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="download-document">
<div class="api-op__main">

## Download a PDF {#download-document}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/documents/{docId}</code></p>

The sealed PDF once the envelope is complete, otherwise the original. Ask for one of
them with `version`. A document signed with Aadhaar eSign cannot take a certificate
page, so its signing certificate is a sealed file of its own: `version=certificate`.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#download-document-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">docId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The document id, from `documents[].id`.

</div>

</div>

### Query parameters {#download-document-query}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">version</code> <span class="api-field__type">string</span></p>

`original`, `sealed` (fails with `INVALID_STATE` until sealing has finished) or `certificate` (fails with `INVALID_STATE` when the certificate is the last page of the sealed file).

<p class="api-field__meta">One of <code>original</code> <code>sealed</code> <code>certificate</code></p>

</div>

</div>

### Returns {#download-document-returns}

**200 OK**. The PDF file. A string.

- `Content-Disposition`: `attachment; filename="<name>-original.pdf"` or `...-sealed.pdf`.

### Errors {#download-document-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048 \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -o document.pdf
```

```ts check [Node.js]
import { writeFile } from 'node:fs/promises';
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const pdf = await sign.envelopes.downloadDocument('7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37', '1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048', {
  version: 'sealed',
});
await writeFile('sealed.pdf', pdf);
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048", nil)
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

<ApiTryIt operation="downloadDocument" />

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

<section class="api-op" aria-labelledby="replace-document">
<div class="api-op__main">

## Replace a draft's document {#replace-document}

<p class="api-route"><span class="api-method" data-method="put">PUT</span><code>/v1/envelopes/{id}/documents/{docId}</code></p>

Uploads a new version of one document of a draft, as multipart (`document`, optional
`name`) or JSON (`name`, `content` in base64). Fields stay where they are when their
page still exists and they fit on it; the others are moved onto the nearest page and
listed in `movedFields`, so you can check them before sending.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#replace-document-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">docId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The document id, from `documents[].id`.

</div>

</div>

### Request body {#replace-document-body}

Send it as `application/json` or `multipart/form-data`.

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">At most 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">content</code> <span class="api-field__type">string (base64)</span> <span class="api-field__required">Required</span></p>

</div>

</div>

### Returns {#replace-document-returns}

**200 OK**. The draft with the new file, and the fields that were moved. An object.

### Errors {#replace-document-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `ENVELOPE_NOT_FOUND`, `RECIPIENT_NOT_FOUND` or `NOT_FOUND`. |
| 409 | `INVALID_STATE`: not allowed in the envelope's status (`details.status`). `NOT_YOUR_TURN`: sequential routing, an earlier recipient has not acted. `CONFLICT`: another request changed the envelope, or one with the same `Idempotency-Key` is still running; try again. |
| 413 | `DOCUMENT_TOO_LARGE`: a PDF or the whole request is over the limit (`details.maxBytes`). |
| 422 | `DOCUMENT_INVALID`: a file is not a readable PDF. `PDF_ALREADY_SIGNED`: a file already carries digital signatures; upload the unsigned original. `REQUIRED_FIELDS_MISSING`: required fields were left empty. `INVALID_FIELD_VALUE`: a value does not suit its field (PNG, date, length). |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X PUT https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048 \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "string",
  "content": "'"$(base64 < string | tr -d '\n')"'"
}'
```

```ts check [Node.js]
import { readFile } from 'node:fs/promises';

const response = await fetch('https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048', {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.SIGN_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'string',
    content: await readFile('string'),
  }),
});
console.log(response.status, await response.json());
```

```python [Python]
import os
import base64

import requests

def b64(path):
    with open(path, "rb") as file:
        return base64.b64encode(file.read()).decode()

response = requests.put(
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
    },
    json={
        "name": "string",
        "content": b64("string"),
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
		"name": "string",
		"content": b64("string"),
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("PUT", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048", bytes.NewReader(payload))
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

<ApiTryIt operation="replaceDocument" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "envelope": {
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
          "signedAt": "2026-03-02T09:14:31.000Z"
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
  "movedFields": [
    "string"
  ]
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="verify-document">
<div class="api-op__main">

## Verify the sealed PDF {#verify-document}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/documents/{docId}/verification</code></p>

Runs the seal check on the stored sealed file against the operator certificate and any
older certificates the server trusts.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#verify-document-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The envelope id.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">docId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The document id, from `documents[].id`.

</div>

</div>

### Returns {#verify-document-returns}

**200 OK**. The result of the check. A `Verification` object.

### Errors {#verify-document-errors}

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
curl https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048/verification \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048/verification', {
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
    "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048/verification",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/envelopes/7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37/documents/1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048/verification", nil)
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

<ApiTryIt operation="verifyDocument" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
  "valid": true,
  "reason": null,
  "signer": {
    "commonName": "Codevibe Sign Seal"
  },
  "signedAt": "2026-03-02T09:14:31.000Z",
  "certificateSha256": "9f2c1a7b3e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8",
  "sha256": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  "seal": "operator",
  "earlierSignatures": []
}
```

:::

</div>

</div>
</section>
