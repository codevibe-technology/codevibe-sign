---
title: "Service"
description: "Health and this document."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

<section class="api-op api-op--intro">
<div class="api-op__main">

# Service

Health and this document.

</div>
<div class="api-op__aside">

<nav class="api-endpoints" aria-label="Endpoints">
<p class="api-endpoints__title">Endpoints</p>
<ul>
<li><a href="#get-health"><span class="api-method" data-method="get">GET</span><code>/health</code></a></li>
<li><a href="#get-open-api"><span class="api-method" data-method="get">GET</span><code>/v1/openapi.json</code></a></li>
</ul>
</nav>

</div>
</section>

<section class="api-op" aria-labelledby="get-health">
<div class="api-op__main">

## Health check {#get-health}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/health</code></p>

Answers as long as the process serves requests. It does not touch the store.

<p class="api-auth"><span class="api-auth__label">Auth</span> None. This route is public.</p>

### Returns {#get-health-returns}

**200 OK**. The server is up. An object.

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/health
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/health');
console.log(response.status, await response.json());
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/health",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/health", nil)
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

<ApiTryIt operation="getHealth" />

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

<section class="api-op" aria-labelledby="get-open-api">
<div class="api-op__main">

## This document {#get-open-api}

<p class="api-route"><span class="api-method" data-method="get">GET</span><code>/v1/openapi.json</code></p>

The OpenAPI 3.1 description of this server's API. Public and cacheable: send the
`ETag` back as `If-None-Match` to get `304 Not Modified` while it is unchanged.

<p class="api-auth"><span class="api-auth__label">Auth</span> None. This route is public.</p>

### Headers {#get-open-api-headers}

<div class="api-fields">

<div class="api-field">
<p class="api-field__head"><code class="api-field__name">If-None-Match</code> <span class="api-field__type">string</span></p>

The `ETag` of a copy you already have.

</div>

</div>

### Returns {#get-open-api-returns}

**200 OK**. The OpenAPI document. An object.

- `ETag`: Changes whenever the document changes.

**304 Not Modified**. Unchanged since the `ETag` in `If-None-Match`.

</div>
<div class="api-op__aside">

<div class="api-panel" data-label="Request">

::: code-group

```sh [curl]
curl https://sign.codevibe.in/api/v1/openapi.json
```

```ts check [Node.js]
const response = await fetch('https://sign.codevibe.in/api/v1/openapi.json');
console.log(response.status, await response.json());
```

```python [Python]
import requests

response = requests.get(
    "https://sign.codevibe.in/api/v1/openapi.json",
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
	req, err := http.NewRequest("GET", "https://sign.codevibe.in/api/v1/openapi.json", nil)
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

<ApiTryIt operation="getOpenApi" />

</div>

<div class="api-panel" data-label="Response">

::: code-group

```json [200 OK]
{
  "openapi": "string",
  "info": {},
  "paths": {}
}
```

:::

</div>

</div>
</section>
