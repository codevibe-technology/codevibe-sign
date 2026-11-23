---
title: "Verification"
description: "Check that a PDF is a document this server sealed and that nothing changed since."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Verification

Check that a PDF is a document this server sealed and that nothing changed since.
Public: no API key, like the certificate page inside every sealed file. Limited per
client address.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#verify-pdf"><span class="api-method" data-method="post">POST</span><code>/v1/verify</code></a></li>
<li><a href="#verify-sha256"><span class="api-method" data-method="get">GET</span><code>/v1/verify/{sha256}</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="the-verification-object">
<div class="api-op__main">

## The verification object {#the-verification-object}

### Attributes {#the-verification-object-attributes}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">valid</code> <span class="api-field__type">boolean</span></p>

The file is exactly what this server sealed, unchanged since.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">reason</code> <span class="api-field__type">string or null</span></p>

The first check that failed; `null` when valid. `unreadable`: the file could not
be read as a PDF. `unknown_document`: no sealed document has this SHA-256. More
values may be added.

<p class="api-field__meta">One of <code>not_sealed</code> <code>multiple_signatures</code> <code>signature_invalid</code> <code>not_whole_document</code> <code>untrusted_signer</code> <code>unreadable</code> <code>unknown_document</code> <code>null</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sha256</code> <span class="api-field__type">string</span></p>

SHA-256 of the file that was checked.

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">checks</code> <span class="api-field__type">object</span></p>

Each check in the order it is made. `true` passed, `false` failed, `null` was not
reached because an earlier one failed.

<details class="api-field__children">
<summary>Attributes of <code>checks</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sealed</code> <span class="api-field__type">boolean or null</span></p>

The file carries a seal.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">singleSignature</code> <span class="api-field__type">boolean or null</span></p>

It carries exactly one signature.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">intact</code> <span class="api-field__type">boolean or null</span></p>

The signature is intact; no byte it covers was changed.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">coversWholeDocument</code> <span class="api-field__type">boolean or null</span></p>

The signature covers the whole file; nothing was added after sealing.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">trustedCertificate</code> <span class="api-field__type">boolean or null</span></p>

The seal was made with this server's certificate, or one it trusts.

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">signer</code> <span class="api-field__type">object or null</span></p>

Who the seal's certificate was issued to.

<details class="api-field__children">
<summary>Attributes of <code>signer</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">commonName</code> <span class="api-field__type">string or null</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">organization</code> <span class="api-field__type">string or null</span></p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">signedAt</code> <span class="api-field__type">string (date-time) or null</span></p>

When the file was sealed, from the signature.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">certificateSha256</code> <span class="api-field__type">string or null</span></p>

SHA-256 of the certificate the seal was made with.

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">envelope</code> <span class="api-field__type">object or null</span></p>

The envelope of a valid file; `null` otherwise, or when it is no longer held.

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
<p class="api-field__head"><code class="api-field__name">documentId</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">Not empty</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">documentName</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sentAt</code> <span class="api-field__type">string (date-time) or null</span></p>

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
<p class="api-field__head"><code class="api-field__name">name</code> <span class="api-field__type">string</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">contact</code> <span class="api-field__type">string or null</span></p>

The email or phone, masked, for example `a****@example.com`.

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
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">actedAt</code> <span class="api-field__type">string (date-time) or null</span></p>

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">events</code> <span class="api-field__type">array of objects</span></p>

<details class="api-field__children">
<summary>Attributes of <code>events</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">seq</code> <span class="api-field__type">integer</span></p>

<p class="api-field__meta">At least 1</p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">action</code> <span class="api-field__type">string</span></p>

<p class="api-field__meta">One of <code>envelope.created</code> <code>envelope.updated</code> <code>envelope.sent</code> <code>envelope.completed</code> <code>envelope.declined</code> <code>envelope.expired</code> <code>envelope.voided</code> <code>recipient.notified</code> <code>recipient.reminded</code> <code>recipient.viewed</code> <code>recipient.authenticated</code> <code>recipient.signed</code> <code>recipient.approved</code> <code>recipient.declined</code> <code>recipient.link_shared</code> <code>recipient.corrected</code> <code>envelope.recalled</code> <code>envelope.revised</code> <code>document.sealed</code></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">at</code> <span class="api-field__type">string (date-time)</span></p>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">recipient</code> <span class="api-field__type">string or null</span></p>

Name of the recipient the event is about.

</div>

</div>

</details>

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">chain</code> <span class="api-field__type">object</span></p>

<details class="api-field__children">
<summary>Attributes of <code>chain</code></summary>

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">valid</code> <span class="api-field__type">boolean</span></p>

The audit hash chain is intact.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">head</code> <span class="api-field__type">string or null</span></p>

The last hash of the chain, as printed on the certificate page.

</div>
<div class="api-field">
<p class="api-field__head"><code class="api-field__name">events</code> <span class="api-field__type">integer</span></p>

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

<div class="api-panel" data-label="Example">

::: code-group

```json [PublicVerification]
{
  "valid": true,
  "reason": null,
  "sha256": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  "checks": {
    "sealed": true,
    "singleSignature": true,
    "intact": true,
    "coversWholeDocument": true,
    "trustedCertificate": true
  },
  "signer": {
    "commonName": "Codevibe Sign Seal",
    "organization": null
  },
  "signedAt": "2026-03-02T09:14:31.000Z",
  "certificateSha256": "9f2c1a7b3e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8",
  "envelope": {
    "id": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
    "title": "Offer letter",
    "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
    "documentName": "offer.pdf",
    "sentAt": "2026-03-02T09:00:00.000Z",
    "completedAt": "2026-03-02T09:14:30.000Z",
    "recipients": [
      {
        "name": "Asha Rao",
        "contact": "a****@example.com",
        "role": "signer",
        "status": "signed",
        "auth": "email_otp",
        "actedAt": "2026-03-02T09:14:30.000Z"
      }
    ],
    "events": [
      {
        "seq": 1,
        "action": "envelope.created",
        "at": "2026-03-02T09:00:00.000Z",
        "recipient": null
      },
      {
        "seq": 2,
        "action": "envelope.sent",
        "at": "2026-03-02T09:00:00.000Z",
        "recipient": null
      },
      {
        "seq": 3,
        "action": "recipient.signed",
        "at": "2026-03-02T09:14:30.000Z",
        "recipient": "Asha Rao"
      },
      {
        "seq": 4,
        "action": "envelope.completed",
        "at": "2026-03-02T09:14:30.000Z",
        "recipient": null
      },
      {
        "seq": 5,
        "action": "document.sealed",
        "at": "2026-03-02T09:14:31.000Z",
        "recipient": null
      }
    ],
    "chain": {
      "valid": true,
      "head": "8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f",
      "events": 5
    }
  }
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="verify-pdf">
<div class="api-op__main">

## Verify a PDF {#verify-pdf}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/verify</code></p>

Upload a PDF to learn whether it is exactly a document this server sealed. The file is
read in memory, checked against the server's seal certificate and dropped: nothing
about it is stored. Send it as a multipart upload in a form field named `file`, or as
the raw body with `Content-Type: application/pdf`.

`checks` lists each check in order; the first that fails is the `reason`, and the
ones after it are `null` because they were not reached. For a valid file the answer
also names its envelope with the signers and the audit trail: the same facts the
certificate page inside the file prints, with contacts masked.

No API key is needed. Each client address may make 30 checks in 10 minutes by default,
and a file may be up to 20 MB.

<p class="api-auth"><span class="api-auth__label">Auth</span> None. This route is public.</p>

### Request body {#verify-pdf-body}

The file itself as the body, with `Content-Type: application/pdf`, or as `multipart/form-data` in a form field named `file`.

### Returns {#verify-pdf-returns}

**200 OK**. The result of the check, whether the file is valid or not. A [verification object](/http-api/reference/verification#the-verification-object).

### Errors {#verify-pdf-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 409 | `INVALID_STATE`: this server has no seal certificate to compare files with. |
| 413 | `DOCUMENT_TOO_LARGE`: a PDF or the whole request is over the limit (`details.maxBytes`). |
| 422 | `DOCUMENT_INVALID`: the file is not a PDF. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/verify \
  -H "Content-Type: application/pdf" \
  --data-binary @sealed.pdf
```

```ts check [Node.js]
import { readFile } from 'node:fs/promises';
import { createVerifyClient } from '@codevibe_technology/sign-client';

// No API key: verification is public.
const verify = createVerifyClient({ baseUrl: 'https://sign.codevibe.in/api' });

const result = await verify.pdf(await readFile('sealed.pdf'));

console.log(result.valid, result.reason, result.envelope?.title);
```

```python [Python]
import requests

with open("sealed.pdf", "rb") as file:
    pdf = file.read()

response = requests.post(
    "https://sign.codevibe.in/api/v1/verify",
    headers={
        "Content-Type": "application/pdf",
    },
    data=pdf,
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
	file, err := os.Open("sealed.pdf")
	if err != nil {
		panic(err)
	}
	defer file.Close()
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/verify", file)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Content-Type", "application/pdf")
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

<ApiTryIt operation="verifyPdf" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "valid": true,
  "reason": null,
  "sha256": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  "checks": {
    "sealed": true,
    "singleSignature": true,
    "intact": true,
    "coversWholeDocument": true,
    "trustedCertificate": true
  },
  "signer": {
    "commonName": "Codevibe Sign Seal",
    "organization": null
  },
  "signedAt": "2026-03-02T09:14:31.000Z",
  "certificateSha256": "9f2c1a7b3e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8",
  "envelope": {
    "id": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
    "title": "Offer letter",
    "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
    "documentName": "offer.pdf",
    "sentAt": "2026-03-02T09:00:00.000Z",
    "completedAt": "2026-03-02T09:14:30.000Z",
    "recipients": [
      {
        "name": "Asha Rao",
        "contact": "a****@example.com",
        "role": "signer",
        "status": "signed",
        "auth": "email_otp",
        "actedAt": "2026-03-02T09:14:30.000Z"
      }
    ],
    "events": [
      {
        "seq": 1,
        "action": "envelope.created",
        "at": "2026-03-02T09:00:00.000Z",
        "recipient": null
      },
      {
        "seq": 2,
        "action": "envelope.sent",
        "at": "2026-03-02T09:00:00.000Z",
        "recipient": null
      },
      {
        "seq": 3,
        "action": "recipient.signed",
        "at": "2026-03-02T09:14:30.000Z",
        "recipient": "Asha Rao"
      },
      {
        "seq": 4,
        "action": "envelope.completed",
        "at": "2026-03-02T09:14:30.000Z",
        "recipient": null
      },
      {
        "seq": 5,
        "action": "document.sealed",
        "at": "2026-03-02T09:14:31.000Z",
        "recipient": null
      }
    ],
    "chain": {
      "valid": true,
      "head": "8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f",
      "events": 5
    }
  }
}
```

:::

</div>

</div>
</section>

<section class="api-op" aria-labelledby="verify-sha256">
<div class="api-op__main">

## Verify by SHA-256 {#verify-sha256}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/verify/{sha256}</code></p>

The same answer without uploading the file: send the SHA-256 of the PDF you hold. The
server looks for a document it sealed with exactly that hash and checks its own stored
copy. A hash it never sealed answers `valid: false` with `unknown_document`, which is
also what a changed file gets, since any change gives another hash.

No API key is needed. It shares the per-address limit of the upload.

<p class="api-auth"><span class="api-auth__label">Auth</span> None. This route is public.</p>

### Path parameters {#verify-sha256-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">sha256</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

SHA-256 of the sealed PDF, 64 hexadecimal characters.

<p class="api-field__meta">Matches <code>^[0-9a-f]{64}$</code></p>

</div>

</div>

### Returns {#verify-sha256-returns}

**200 OK**. The result of the check. A [verification object](/http-api/reference/verification#the-verification-object).

### Errors {#verify-sha256-errors}

| Status | When |
| ------ | ---- |
| 400 | `VALIDATION`: the request is malformed. `details.issues` lists each problem. |
| 409 | `INVALID_STATE`: this server has no seal certificate to compare files with. |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/verify/1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d
```

```ts check [Node.js]
import { createVerifyClient } from '@codevibe_technology/sign-client';

// No API key: verification is public.
const verify = createVerifyClient({ baseUrl: 'https://sign.codevibe.in/api' });

const result = await verify.sha256('1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d');

console.log(result.valid, result.reason);
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/verify/1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/verify/1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", nil)
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

<ApiTryIt operation="verifySha256" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "valid": true,
  "reason": null,
  "sha256": "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  "checks": {
    "sealed": true,
    "singleSignature": true,
    "intact": true,
    "coversWholeDocument": true,
    "trustedCertificate": true
  },
  "signer": {
    "commonName": "Codevibe Sign Seal",
    "organization": null
  },
  "signedAt": "2026-03-02T09:14:31.000Z",
  "certificateSha256": "9f2c1a7b3e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8",
  "envelope": {
    "id": "7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37",
    "title": "Offer letter",
    "documentId": "1b8e4f60-2c3a-4d7e-8f91-a5c2e6b3d048",
    "documentName": "offer.pdf",
    "sentAt": "2026-03-02T09:00:00.000Z",
    "completedAt": "2026-03-02T09:14:30.000Z",
    "recipients": [
      {
        "name": "Asha Rao",
        "contact": "a****@example.com",
        "role": "signer",
        "status": "signed",
        "auth": "email_otp",
        "actedAt": "2026-03-02T09:14:30.000Z"
      }
    ],
    "events": [
      {
        "seq": 1,
        "action": "envelope.created",
        "at": "2026-03-02T09:00:00.000Z",
        "recipient": null
      },
      {
        "seq": 2,
        "action": "envelope.sent",
        "at": "2026-03-02T09:00:00.000Z",
        "recipient": null
      },
      {
        "seq": 3,
        "action": "recipient.signed",
        "at": "2026-03-02T09:14:30.000Z",
        "recipient": "Asha Rao"
      },
      {
        "seq": 4,
        "action": "envelope.completed",
        "at": "2026-03-02T09:14:30.000Z",
        "recipient": null
      },
      {
        "seq": 5,
        "action": "document.sealed",
        "at": "2026-03-02T09:14:31.000Z",
        "recipient": null
      }
    ],
    "chain": {
      "valid": true,
      "head": "8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f",
      "events": 5
    }
  }
}
```

:::

</div>

</div>
</section>
