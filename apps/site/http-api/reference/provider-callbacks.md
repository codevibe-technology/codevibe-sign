---
title: "Provider callbacks"
description: "Where an Aadhaar eSign provider reports what became of a signing request."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Provider callbacks

Where an Aadhaar eSign provider reports what became of a signing request. Called by
the provider, never by your code. Each callback is verified with the credentials of
the workspace that started the request.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#receive-esign-webhook"><span class="api-method" data-method="post">POST</span><code>/v1/esign/webhooks/{provider}</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="receive-esign-webhook">
<div class="api-op__main">

## Receive an eSign provider's callback {#receive-esign-webhook}

<p class="api-route"><span class="api-method" data-method="post">POST</span><code>/v1/esign/webhooks/{provider}</code></p>

Set this address as the webhook of your eSign provider account. The body names the
signing request; the server finds the workspace that started it and verifies the
body with that workspace's provider credentials before acting on it. Repeats change
nothing. Bodies over 256 KB are refused.

<p class="api-auth"><span class="api-auth__label">Auth</span> The link itself.</p>

### Path parameters {#receive-esign-webhook-path}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">provider</code> <span class="api-field__type">string</span> <span class="api-field__required">Required</span></p>

The eSign provider's name, for example `leegality`.

<p class="api-field__meta">Matches <code>^[a-z0-9][a-z0-9_-]{0,39}$</code></p>

</div>

</div>

### Request body {#receive-esign-webhook-body}

A object.

### Returns {#receive-esign-webhook-returns}

**200 OK**. The callback was verified. It may have changed nothing. An object.

### Errors {#receive-esign-webhook-errors}

| Status | When |
| ------ | ---- |
| 401 | The callback could not be verified. |
| 404 | No signing request matches the callback, or eSign is not set up. |
| 413 | `DOCUMENT_TOO_LARGE`: a PDF or the whole request is over the limit (`details.maxBytes`). |
| 429 | `RATE_LIMITED`: too many requests. Wait `Retry-After` seconds. |

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl -X POST https://sign.codevibe.in/api/v1/esign/webhooks/string \
  -H "Content-Type: application/json" \
  -d '{}'
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/esign/webhooks/string', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});
console.log(response.status, await response.json());
```

```python [Python]
import requests

response = requests.post(
    "https://sign.codevibe.in/api/v1/esign/webhooks/string",
    json={},
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
	payload, err := json.Marshal(map[string]any{})
	if err != nil {
		panic(err)
	}
	req, err := http.NewRequest("POST", "https://sign.codevibe.in/api/v1/esign/webhooks/string", bytes.NewReader(payload))
	if err != nil {
		panic(err)
	}
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

<ApiTryIt operation="receiveEsignWebhook" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "ok": true
}
```

:::

</div>

</div>
</section>
