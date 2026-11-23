---
title: Run a local sandbox
description: Start a throwaway Codevibe Sign server on your machine with in-memory storage and a fresh API key, and call it from curl, Postman or the reference's Try it panel.
---

# Run a local sandbox

A sandbox is a complete Codevibe Sign server that keeps everything in memory, seals with a
generated self-signed certificate and prints emails and one-time codes in the terminal instead
of sending them. It is the safe place to try requests: nothing leaves your machine and nothing
is kept when it stops.

## Start it

You need Node 22.18 or later.

```sh
npx @codevibe_technology/sign-server start --memory
```

It prints what you need:

```text
Codevibe Sign 0.1.0 (memory mode: nothing is saved, for local development only)

API              http://localhost:3000
Health           http://localhost:3000/health
Signing links    http://localhost:3000/sign/...
API key          3c2f0e...
Seal             generated, self-signed
Email and codes  printed here instead of sent
```

Set `API_KEYS` to keep the same key between runs, and `--port` to use another port. Press
Ctrl+C to stop; everything is gone.

## Call it

::: code-group

```sh [curl]
KEY=<printed api key>
curl -s http://localhost:3000/health
curl -s -H "Authorization: Bearer $KEY" http://localhost:3000/v1/envelopes
```

```ts check [Node.js]
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.SIGN_API_KEY!,
});
```

:::

Every example in the [API reference](/http-api/reference) works against the sandbox once you
replace `https://sign.codevibe.in/api` with `http://localhost:3000`. The create example carries a
small real PDF, so it works as it is.

## Try it from the reference

Each route in the reference has a **Try it** panel with two modes:

- **Mock** answers in your browser from the API description. It checks the path and the body
  the way the server would and returns the documented answer. Nothing is sent anywhere, so it
  works on the public site.
- **Local sandbox** sends the request to a server on your machine. It is offered only when the
  docs themselves run on your machine, and only to `localhost` addresses. The public site never
  sends requests to any server, so an API key can never be typed into it and sent to the live
  API.

To use the sandbox mode, run the docs locally with the sandbox behind them. The docs' dev server
passes `/v1`, `/sign` and `/health` through to it, so the browser sees one origin and needs no
CORS:

```sh
git clone https://github.com/codevibe-technology/codevibe-sign.git
cd codevibe-sign && pnpm install && pnpm build

npx @codevibe_technology/sign-server start --memory          # terminal 1
SIGN_SERVER=http://localhost:3000 pnpm --filter site dev     # terminal 2
```

Open `http://localhost:5173/docs/http-api/reference`, choose **Local sandbox**, keep the
suggested URL (the docs' own address) and paste the printed API key. The key stays in the form
and is never saved.

For the signing routes, take the token from a signing link printed in the sandbox terminal.
Signers with a one-time code call **Send a one-time code**, read the code from the terminal,
verify it, and send the returned `sessionToken` as `X-Sign-Session`.

## Or use Postman or Insomnia

Import the [Postman collection](/codevibe-sign.postman_collection.json) (Insomnia imports it
too), set `baseUrl` to `http://localhost:3000` and `apiKey` to the printed key, and send
**Create an envelope**. The requests after it pick up `envelopeId` and `docId` automatically.
Desktop clients do not need CORS.

## Adding CORS yourself

The server sends no CORS headers. The `node-embed` example puts a small Hono app in front of
it when a page on another origin must call it:

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use(
  '*',
  cors({
    origin: corsOrigins,
    allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Sign-Session'],
  }),
);
app.all('*', (c) => sign.app.fetch(c.req.raw, c.env));
await listen(app, { port });
```

Do the same in your own deployment only for origins you control, and never for pages that
would hold a sender API key.

## Next

[API reference](/http-api/reference)
