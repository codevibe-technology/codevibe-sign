---
title: "Templates"
description: "A template is an envelope without the people: its PDFs, the roles that act on them (Employee, HR), the fields each role fills and the settings."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Templates

A template is an envelope without the people: its PDFs, the roles that act on them
(Employee, HR), the fields each role fills and the settings. Make an envelope from one by
saying who takes each role. Sender API key required.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#list-templates"><span class="api-method" data-method="get">GET</span><code>/v1/templates</code></a></li>
<li><a href="#create-template"><span class="api-method" data-method="post">POST</span><code>/v1/templates</code></a></li>
<li><a href="#get-template"><span class="api-method" data-method="get">GET</span><code>/v1/templates/{templateId}</code></a></li>
<li><a href="#update-template"><span class="api-method" data-method="patch">PATCH</span><code>/v1/templates/{templateId}</code></a></li>
<li><a href="#delete-template"><span class="api-method" data-method="delete">DELETE</span><code>/v1/templates/{templateId}</code></a></li>
<li><a href="#create-envelope-from-template"><span class="api-method" data-method="post">POST</span><code>/v1/templates/{templateId}/envelopes</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="the-template-object">
<div class="api-op__main">

## The template object {#the-template-object}

### Attributes {#the-template-object-attributes}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">description</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span></p>

Title of the envelopes made from the template.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string</span></p>

Shown to recipients in the invitation and on the signing page.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">routing</code> <span class="api-field__type">string</span></p>

`sequential` goes by `order`, lowest first (equal orders sign together); `parallel` invites everyone at once.

<p class="api-field__meta">One of <code>sequential</code> <code>parallel</code></p>

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
<p class="api-field__head"><code class="api-field__name">expiresInDays</code> <span class="api-field__type">integer</span></p>

Envelopes expire this many days after they are created.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">roles</code> <span class="api-field__type">array of objects</span></p>

<details class="api-field__children">
<summary>Attributes of <code>roles</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

Unique within the template, ignoring case.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

Signers fill fields, approvers approve without fields, viewers get a copy.

<p class="api-field__meta">One of <code>signer</code> <code>approver</code> <code>viewer</code></p>

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
<p class="api-field__head"><code class="api-field__name">size</code> <span class="api-field__type">integer</span></p>

Size of the PDF in bytes.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sha256</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">pageCount</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">pages</code> <span class="api-field__type">array of objects</span></p>

Page sizes in PDF points, in page order.

<details class="api-field__children">
<summary>Attributes of <code>pages</code></summary>

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
<p class="api-field__head"><code class="api-field__name">roleId</code> <span class="api-field__type">string</span></p>

The role whose person fills the field in.

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>signature</code> <code>initials</code> <code>date_signed</code> <code>name</code> <code>text</code> <code>checkbox</code></p>

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

Text fields are prefilled by label.

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">createdAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">updatedAt</code> <span class="api-field__type">string (date-time)</span></p>

</div>

</div>

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Example">

::: code-group

```json [Template]
{
  "id": "3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
  "name": "Offer letter",
  "description": "Standard offer for full-time staff",
  "title": "Offer letter",
  "message": "Welcome aboard. Please sign your offer.",
  "routing": "sequential",
  "reminders": {
    "firstAfterDays": 3,
    "everyDays": 3,
    "max": 3
  },
  "expiresInDays": 30,
  "roles": [
    {
      "id": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "name": "Employee",
      "type": "signer",
      "auth": "email_otp"
    },
    {
      "id": "6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
      "name": "HR",
      "type": "viewer",
      "auth": "email_otp"
    }
  ],
  "documents": [
    {
      "id": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "name": "offer.pdf",
      "size": 1042,
      "sha256": "4f2a9c1e7b3d5a6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7",
      "pageCount": 1,
      "pages": [
        {
          "width": 612,
          "height": 792
        }
      ]
    }
  ],
  "fields": [
    {
      "id": "7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 640,
        "width": 180,
        "height": 48
      },
      "required": true
    },
    {
      "id": "8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "text",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 600,
        "width": 180,
        "height": 20
      },
      "required": false,
      "label": "Employee code"
    }
  ],
  "createdAt": "2026-03-02T09:00:00.000Z",
  "updatedAt": "2026-03-02T09:00:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="list-templates">
<div class="api-op__main">

## List templates {#list-templates}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/templates</code></p>

The caller's workspace's templates, newest first, one page at a time. Pass the
`nextCursor` of a page as `cursor` to get the next one. Each row is a summary; get the
template for its documents, roles and fields.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Results come one page at a time. See [pagination](/http-api/conventions#pagination).

### Query parameters {#list-templates-query}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">q</code> <span class="api-field__type">string</span></p>

Case-insensitive text anywhere in the name.

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

### Returns {#list-templates-returns}

**200 OK**. One page of templates. A `TemplateList` object.

### Errors {#list-templates-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 409 | `INVALID_STATE`: this server keeps no templates, or a PDF of the template is missing from storage. `CONFLICT`: another request changed the template, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/templates \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const { templates, nextCursor } = await sign.templates.list({ limit: 25 });
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/templates",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/templates", nil)
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

<ApiTryIt operation="listTemplates" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "templates": [
    {
      "id": "3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
      "name": "Offer letter",
      "description": "Standard offer for full-time staff",
      "roles": [
        {
          "name": "Employee",
          "type": "signer"
        },
        {
          "name": "HR",
          "type": "viewer"
        }
      ],
      "documentCount": 1,
      "pageCount": 1,
      "createdAt": "2026-03-02T09:00:00.000Z",
      "updatedAt": "2026-03-02T09:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="create-template">
<div class="api-op__main">

## Create a template {#create-template}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/templates</code></p>

Stores the PDFs with the roles, fields and settings to reuse. Send the PDFs either as
base64 in JSON, or as a multipart upload with the template JSON in a form field named
`template` and the files as `documents`.

Fields name their role by its `key` in the same request. Each PDF is checked like an
envelope's, and field boxes must fit on their page.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Headers {#create-template-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#create-template-body}

Send it as `application/json` or `multipart/form-data`.

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

What the template is called in lists.

<p class="api-field__meta">1 to 120 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span></p>

Title of the envelopes made from it. Default the name.

<p class="api-field__meta">1 to 200 characters</p>

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
<p class="api-field__head"><code class="api-field__name">expiresInDays</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">Default <code>30</code><span aria-hidden="true"> · </span>1 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">description</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">1 to 500 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">1 to 5000 characters</p>

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
<p class="api-field__head"><code class="api-field__name">roles</code> <span class="api-field__type">array of objects</span> <span class="api-field__required">Required</span></p>

At least one must be a signer or an approver.

<p class="api-field__meta">1 to 50 items</p>

<details class="api-field__children">
<summary>Attributes of <code>roles</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">key</code> <span class="api-field__type">string</span></p>

How fields refer to this role in the same request. Default its position, `"0"`.

<p class="api-field__meta">At most 100 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

On `PATCH`, the id of an existing role to keep.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

For example `Employee`. Unique within the template, ignoring case.

<p class="api-field__meta">1 to 60 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

Signers fill fields, approvers approve without fields, viewers get a copy.

<p class="api-field__meta">One of <code>signer</code> <code>approver</code> <code>viewer</code><span aria-hidden="true"> · </span>Default <code>signer</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">auth</code> <span class="api-field__type">string</span></p>

How the recipient proves who they are. `email_otp`, the default, asks for the link and a code sent by email; `email_link` needs only the link.

<p class="api-field__meta">One of <code>email_link</code> <code>email_otp</code> <code>sms_otp</code> <code>aadhaar</code><span aria-hidden="true"> · </span>Default <code>email_otp</code></p>

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
<p class="api-field__head"><code class="api-field__name">role</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The role's `key` (or `id` on `PATCH`). Viewers have no fields.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">document</code> <span class="api-field__type">string</span></p>

The document's `key` or `id`. Optional when the template has one document.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>signature</code> <code>initials</code> <code>date_signed</code> <code>name</code> <code>text</code> <code>checkbox</code><span aria-hidden="true"> · </span>Default <code>signature</code></p>

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

Give text fields a label to prefill them by.

<p class="api-field__meta">At most 200 characters</p>

</div>

</div>

</details>

</div>

</div>

### Returns {#create-template-returns}

**201 Created**. The template. A [template object](/http-api/reference/templates#the-template-object).

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#create-template-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 409 | `INVALID_STATE`: this server keeps no templates, or a PDF of the template is missing from storage. `CONFLICT`: another request changed the template, or one with the same `Idempotency-Key` is still running; try again. |
| 413 | `DOCUMENT_TOO_LARGE`: a PDF or the whole request is over the limit (`details.maxBytes`). |
| 422 | `DOCUMENT_INVALID`: a file is not a readable PDF. `PDF_ALREADY_SIGNED`: a file already carries digital signatures; upload the unsigned original. `REQUIRED_FIELDS_MISSING`: required fields were left empty. `INVALID_FIELD_VALUE`: a value does not suit its field (PNG, date, length). |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |
| 500 | `INTERNAL` or `SEAL_FAILED`. Safe to retry with the same `Idempotency-Key`. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/templates \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Offer letter",
  "description": "Standard offer for full-time staff",
  "message": "Welcome aboard. Please sign your offer.",
  "documents": [
    {
      "key": "offer",
      "name": "offer.pdf",
      "content": "'"$(base64 < offer.pdf | tr -d '\n')"'"
    }
  ],
  "roles": [
    {
      "key": "employee",
      "name": "Employee"
    },
    {
      "key": "hr",
      "name": "HR",
      "type": "viewer"
    }
  ],
  "fields": [
    {
      "role": "employee",
      "document": "offer",
      "type": "signature",
      "page": 0,
      "x": 72,
      "y": 640,
      "width": 180,
      "height": 48
    },
    {
      "role": "employee",
      "type": "text",
      "label": "Employee code",
      "page": 0,
      "x": 72,
      "y": 600,
      "width": 180,
      "height": 20,
      "required": false
    }
  ]
}'
```

```ts check [Node.js]
import { readFile } from 'node:fs/promises';
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const template = await sign.templates.create({
  name: 'Offer letter',
  description: 'Standard offer for full-time staff',
  message: 'Welcome aboard. Please sign your offer.',
  documents: [
    {
      key: 'offer',
      name: 'offer.pdf',
      content: await readFile('offer.pdf'),
    },
  ],
  roles: [
    {
      key: 'employee',
      name: 'Employee',
    },
    {
      key: 'hr',
      name: 'HR',
      type: 'viewer',
    },
  ],
  fields: [
    {
      role: 'employee',
      document: 'offer',
      type: 'signature',
      page: 0,
      x: 72,
      y: 640,
      width: 180,
      height: 48,
    },
    {
      role: 'employee',
      type: 'text',
      label: 'Employee code',
      page: 0,
      x: 72,
      y: 600,
      width: 180,
      height: 20,
      required: false,
    },
  ],
});

console.log(template.id, template.roles);
```

```python [Python]
import os
import base64

import requests

def b64(path):
    with open(path, "rb") as file:
        return base64.b64encode(file.read()).decode()

response = requests.post(
    "https://sign.codevibe.in/api/v1/templates",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "name": "Offer letter",
        "description": "Standard offer for full-time staff",
        "message": "Welcome aboard. Please sign your offer.",
        "documents": [
            {
                "key": "offer",
                "name": "offer.pdf",
                "content": b64("offer.pdf"),
            },
        ],
        "roles": [
            {
                "key": "employee",
                "name": "Employee",
            },
            {
                "key": "hr",
                "name": "HR",
                "type": "viewer",
            },
        ],
        "fields": [
            {
                "role": "employee",
                "document": "offer",
                "type": "signature",
                "page": 0,
                "x": 72,
                "y": 640,
                "width": 180,
                "height": 48,
            },
            {
                "role": "employee",
                "type": "text",
                "label": "Employee code",
                "page": 0,
                "x": 72,
                "y": 600,
                "width": 180,
                "height": 20,
                "required": False,
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
		"name": "Offer letter",
		"description": "Standard offer for full-time staff",
		"message": "Welcome aboard. Please sign your offer.",
		"documents": []any{
			map[string]any{
				"key": "offer",
				"name": "offer.pdf",
				"content": b64("offer.pdf"),
			},
		},
		"roles": []any{
			map[string]any{
				"key": "employee",
				"name": "Employee",
			},
			map[string]any{
				"key": "hr",
				"name": "HR",
				"type": "viewer",
			},
		},
		"fields": []any{
			map[string]any{
				"role": "employee",
				"document": "offer",
				"type": "signature",
				"page": 0,
				"x": 72,
				"y": 640,
				"width": 180,
				"height": 48,
			},
			map[string]any{
				"role": "employee",
				"type": "text",
				"label": "Employee code",
				"page": 0,
				"x": 72,
				"y": 600,
				"width": 180,
				"height": 20,
				"required": false,
			},
		},
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/templates", bytes.NewReader(payload))
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

<ApiTryIt operation="createTemplate" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [201 Created]
{
  "id": "3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
  "name": "Offer letter",
  "description": "Standard offer for full-time staff",
  "title": "Offer letter",
  "message": "Welcome aboard. Please sign your offer.",
  "routing": "sequential",
  "reminders": {
    "firstAfterDays": 3,
    "everyDays": 3,
    "max": 3
  },
  "expiresInDays": 30,
  "roles": [
    {
      "id": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "name": "Employee",
      "type": "signer",
      "auth": "email_otp"
    },
    {
      "id": "6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
      "name": "HR",
      "type": "viewer",
      "auth": "email_otp"
    }
  ],
  "documents": [
    {
      "id": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "name": "offer.pdf",
      "size": 1042,
      "sha256": "4f2a9c1e7b3d5a6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7",
      "pageCount": 1,
      "pages": [
        {
          "width": 612,
          "height": 792
        }
      ]
    }
  ],
  "fields": [
    {
      "id": "7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 640,
        "width": 180,
        "height": 48
      },
      "required": true
    },
    {
      "id": "8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "text",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 600,
        "width": 180,
        "height": 20
      },
      "required": false,
      "label": "Employee code"
    }
  ],
  "createdAt": "2026-03-02T09:00:00.000Z",
  "updatedAt": "2026-03-02T09:00:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="get-template">
<div class="api-op__main">

## Get a template {#get-template}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/templates/{templateId}</code></p>

The template with its documents, roles, fields and settings.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#get-template-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">templateId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The template id.

</div>

</div>

### Returns {#get-template-returns}

**200 OK**. The template. A [template object](/http-api/reference/templates#the-template-object).

### Errors {#get-template-errors}

| Status | When |
| ------ | ---- |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 404 | `NOT_FOUND`: no such template in the workspace of the API key. |
| 409 | `INVALID_STATE`: this server keeps no templates, or a PDF of the template is missing from storage. `CONFLICT`: another request changed the template, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const template = await sign.templates.get('3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d');
```

```python [Python]
import os

import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d", nil)
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

<ApiTryIt operation="getTemplate" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "id": "3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
  "name": "Offer letter",
  "description": "Standard offer for full-time staff",
  "title": "Offer letter",
  "message": "Welcome aboard. Please sign your offer.",
  "routing": "sequential",
  "reminders": {
    "firstAfterDays": 3,
    "everyDays": 3,
    "max": 3
  },
  "expiresInDays": 30,
  "roles": [
    {
      "id": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "name": "Employee",
      "type": "signer",
      "auth": "email_otp"
    },
    {
      "id": "6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
      "name": "HR",
      "type": "viewer",
      "auth": "email_otp"
    }
  ],
  "documents": [
    {
      "id": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "name": "offer.pdf",
      "size": 1042,
      "sha256": "4f2a9c1e7b3d5a6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7",
      "pageCount": 1,
      "pages": [
        {
          "width": 612,
          "height": 792
        }
      ]
    }
  ],
  "fields": [
    {
      "id": "7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 640,
        "width": 180,
        "height": 48
      },
      "required": true
    },
    {
      "id": "8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "text",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 600,
        "width": 180,
        "height": 20
      },
      "required": false,
      "label": "Employee code"
    }
  ],
  "createdAt": "2026-03-02T09:00:00.000Z",
  "updatedAt": "2026-03-02T09:00:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="update-template">
<div class="api-op__main">

## Change a template {#update-template}

<p class="api-route"><span class="api-method" data-method="patch">PATCH</span><code>/v1/templates/{templateId}</code></p>

Only the properties you send change. `roles` and `fields`, when sent, replace the
existing ones; give a role its `id` to keep it. Fields you do not resend must still
have their role. The documents of a template cannot be changed: create a new template
instead. Envelopes already made from the template are not affected.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#update-template-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">templateId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The template id.

</div>

</div>

### Request body {#update-template-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

What the template is called in lists.

<p class="api-field__meta">1 to 120 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span></p>

Title of the envelopes made from it. Default the name.

<p class="api-field__meta">1 to 200 characters</p>

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
<p class="api-field__head"><code class="api-field__name">expiresInDays</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">Default <code>30</code><span aria-hidden="true"> · </span>1 to 365</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">description</code> <span class="api-field__type">string or null</span></p>

Send null to clear it.

<p class="api-field__meta">At most 500 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string or null</span></p>

Send null to clear it.

<p class="api-field__meta">At most 5000 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">roles</code> <span class="api-field__type">array of objects</span></p>

Replaces the roles. Include `id` to keep an existing one.

<p class="api-field__meta">1 to 50 items</p>

<details class="api-field__children">
<summary>Attributes of <code>roles</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">key</code> <span class="api-field__type">string</span></p>

How fields refer to this role in the same request. Default its position, `"0"`.

<p class="api-field__meta">At most 100 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">id</code> <span class="api-field__type">string</span></p>

On `PATCH`, the id of an existing role to keep.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

For example `Employee`. Unique within the template, ignoring case.

<p class="api-field__meta">1 to 60 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

Signers fill fields, approvers approve without fields, viewers get a copy.

<p class="api-field__meta">One of <code>signer</code> <code>approver</code> <code>viewer</code><span aria-hidden="true"> · </span>Default <code>signer</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">auth</code> <span class="api-field__type">string</span></p>

How the recipient proves who they are. `email_otp`, the default, asks for the link and a code sent by email; `email_link` needs only the link.

<p class="api-field__meta">One of <code>email_link</code> <code>email_otp</code> <code>sms_otp</code> <code>aadhaar</code><span aria-hidden="true"> · </span>Default <code>email_otp</code></p>

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
<p class="api-field__head"><code class="api-field__name">role</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The role's `key` (or `id` on `PATCH`). Viewers have no fields.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">document</code> <span class="api-field__type">string</span></p>

The document's `key` or `id`. Optional when the template has one document.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">type</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>signature</code> <code>initials</code> <code>date_signed</code> <code>name</code> <code>text</code> <code>checkbox</code><span aria-hidden="true"> · </span>Default <code>signature</code></p>

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

Give text fields a label to prefill them by.

<p class="api-field__meta">At most 200 characters</p>

</div>

</div>

</details>

</div>

</div>

### Returns {#update-template-returns}

**200 OK**. The changed template. A [template object](/http-api/reference/templates#the-template-object).

### Errors {#update-template-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `NOT_FOUND`: no such template in the workspace of the API key. |
| 409 | `INVALID_STATE`: this server keeps no templates, or a PDF of the template is missing from storage. `CONFLICT`: another request changed the template, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X PATCH https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Offer letter 2026",
  "message": "Welcome aboard. Please sign by Friday.",
  "expiresInDays": 14
}'
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const template = await sign.templates.update('3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d', {
  name: 'Offer letter 2026',
  message: 'Welcome aboard. Please sign by Friday.',
  expiresInDays: 14,
});
```

```python [Python]
import os

import requests

response = requests.patch(
    "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
    },
    json={
        "name": "Offer letter 2026",
        "message": "Welcome aboard. Please sign by Friday.",
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
		"name": "Offer letter 2026",
		"message": "Welcome aboard. Please sign by Friday.",
		"expiresInDays": 14,
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("PATCH", "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d", bytes.NewReader(payload))
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

<ApiTryIt operation="updateTemplate" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "id": "3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
  "name": "Offer letter",
  "description": "Standard offer for full-time staff",
  "title": "Offer letter",
  "message": "Welcome aboard. Please sign your offer.",
  "routing": "sequential",
  "reminders": {
    "firstAfterDays": 3,
    "everyDays": 3,
    "max": 3
  },
  "expiresInDays": 30,
  "roles": [
    {
      "id": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "name": "Employee",
      "type": "signer",
      "auth": "email_otp"
    },
    {
      "id": "6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
      "name": "HR",
      "type": "viewer",
      "auth": "email_otp"
    }
  ],
  "documents": [
    {
      "id": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "name": "offer.pdf",
      "size": 1042,
      "sha256": "4f2a9c1e7b3d5a6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7",
      "pageCount": 1,
      "pages": [
        {
          "width": 612,
          "height": 792
        }
      ]
    }
  ],
  "fields": [
    {
      "id": "7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "signature",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 640,
        "width": 180,
        "height": 48
      },
      "required": true
    },
    {
      "id": "8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a",
      "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
      "roleId": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "type": "text",
      "page": 0,
      "rect": {
        "x": 72,
        "y": 600,
        "width": 180,
        "height": 20
      },
      "required": false,
      "label": "Employee code"
    }
  ],
  "createdAt": "2026-03-02T09:00:00.000Z",
  "updatedAt": "2026-03-02T09:00:00.000Z"
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="delete-template">
<div class="api-op__main">

## Delete a template {#delete-template}

<p class="api-route"><span class="api-method" data-method="delete">DELETE</span><code>/v1/templates/{templateId}</code></p>

Removes the template and its stored PDFs for good. Envelopes already made from it keep
their own copies and are not affected.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

### Path parameters {#delete-template-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">templateId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The template id.

</div>

</div>

### Returns {#delete-template-returns}

**200 OK**. The template is gone. An object.

### Errors {#delete-template-errors}

| Status | When |
| ------ | ---- |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `NOT_FOUND`: no such template in the workspace of the API key. |
| 409 | `INVALID_STATE`: this server keeps no templates, or a PDF of the template is missing from storage. `CONFLICT`: another request changed the template, or one with the same `Idempotency-Key` is still running; try again. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X DELETE https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

await sign.templates.delete('3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d');
```

```python [Python]
import os

import requests

response = requests.delete(
    "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
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
	req, err := http.NewRequest("DELETE", "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d", nil)
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

<ApiTryIt operation="deleteTemplate" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "id": "3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d",
  "deleted": true
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="create-envelope-from-template">
<div class="api-op__main">

## Create an envelope from a template {#create-envelope-from-template}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/templates/{templateId}/envelopes</code></p>

Makes an envelope with the template's documents, fields and settings, and the people
you name for its roles. `roles` is keyed by role name (case does not matter) or role
id, and every role needs a person. `prefill` sets text fields by their label or id
before anyone signs. The envelope is a draft unless `send` is `true`, and from then on
it is an ordinary envelope: `metadata.templateId` says where it came from.

Counts towards the same per-minute limit as creating envelopes.

<p class="api-auth"><span class="api-auth__label">Auth</span> Sender API key, as <code>Authorization: Bearer &lt;key&gt;</code></p>

Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).

### Path parameters {#create-envelope-from-template-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">templateId</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The template id.

</div>

</div>

### Headers {#create-envelope-from-template-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">Idempotency-Key</code> <span class="api-field__type">string</span></p>

Any unique string, up to 255 characters. A retry with the same key and body within
24 hours returns the first response. The same key with a different body is a
`VALIDATION` error; while the first request is still running, `CONFLICT`.

<p class="api-field__meta">1 to 255 characters</p>

</div>

</div>

### Request body {#create-envelope-from-template-body}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">roles</code> <span class="api-field__type">map</span> <span class="api-field__required">Required</span></p>

One person for every role of the template, keyed by role name or role id.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">prefill</code> <span class="api-field__type">map</span></p>

Values for text fields, keyed by field label (case does not matter) or field id.
A label shared by several fields fills them all. Recipients may change the values.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">title</code> <span class="api-field__type">string</span></p>

Replaces the template's title for this envelope.

<p class="api-field__meta">1 to 200 characters</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">message</code> <span class="api-field__type">string or null</span></p>

Replaces the template's message for this envelope; null sends none.

<p class="api-field__meta">1 to 5000 characters</p>

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

Used when `expiresAt` is not set. Default the template's.

<p class="api-field__meta">1 to 365</p>

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

</div>

### Returns {#create-envelope-from-template-returns}

**201 Created**. The envelope, as a draft or already sent. An [envelope object](/http-api/reference/envelopes#the-envelope-object).

- `Idempotent-Replayed`: `true` when this is the stored response to an earlier request with the same `Idempotency-Key`.

### Errors {#create-envelope-from-template-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 401 | `UNAUTHORIZED`: the API key is missing or not valid. |
| 403 | `FORBIDDEN`: the credential may only read. |
| 404 | `NOT_FOUND`: no such template in the workspace of the API key. |
| 409 | `INVALID_STATE`: this server keeps no templates, or a PDF of the template is missing from storage. `CONFLICT`: another request changed the template, or one with the same `Idempotency-Key` is still running; try again. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |
| 500 | `INTERNAL` or `SEAL_FAILED`. Safe to retry with the same `Idempotency-Key`. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d/envelopes \
  -H "Authorization: Bearer $SIGN_API_KEY" \
  -H "Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
  -H "Content-Type: application/json" \
  -d '{
  "roles": {
    "Employee": {
      "name": "Asha Rao",
      "email": "asha@example.com"
    },
    "HR": {
      "name": "HR Team",
      "email": "hr@example.com"
    }
  },
  "prefill": {
    "Employee code": "E-1042"
  },
  "metadata": {
    "employeeId": "E-1042"
  },
  "send": true
}'
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const envelope = await sign.templates.createEnvelope('3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d', {
  roles: {
    Employee: {
      name: 'Asha Rao',
      email: 'asha@example.com',
    },
    HR: {
      name: 'HR Team',
      email: 'hr@example.com',
    },
  },
  prefill: {
    'Employee code': 'E-1042',
  },
  metadata: {
    employeeId: 'E-1042',
  },
  send: true,
});

console.log(envelope.id, envelope.status);
```

```python [Python]
import os

import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d/envelopes",
    headers={
        "Authorization": f"Bearer {os.environ['SIGN_API_KEY']}",
        "Idempotency-Key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    },
    json={
        "roles": {
            "Employee": {
                "name": "Asha Rao",
                "email": "asha@example.com",
            },
            "HR": {
                "name": "HR Team",
                "email": "hr@example.com",
            },
        },
        "prefill": {
            "Employee code": "E-1042",
        },
        "metadata": {
            "employeeId": "E-1042",
        },
        "send": True,
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
		"roles": map[string]any{
			"Employee": map[string]any{
				"name": "Asha Rao",
				"email": "asha@example.com",
			},
			"HR": map[string]any{
				"name": "HR Team",
				"email": "hr@example.com",
			},
		},
		"prefill": map[string]any{
			"Employee code": "E-1042",
		},
		"metadata": map[string]any{
			"employeeId": "E-1042",
		},
		"send": true,
	})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/templates/3d6f0a1c-8b2e-4f7a-9c5d-1e2f3a4b5c6d/envelopes", bytes.NewReader(payload))
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

<ApiTryIt operation="createEnvelopeFromTemplate" />

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
