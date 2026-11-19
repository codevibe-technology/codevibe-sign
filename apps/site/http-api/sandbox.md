---
title: Run a local sandbox
description: Start a throwaway Codevibe Sign server on your machine with in-memory storage, an API key and CORS for the docs, then try every route from the interactive reference.
---

# Run a local sandbox

The `node-embed` example starts a complete server in one process: in-memory storage, a
self-signed seal certificate, and signing links and one-time codes printed to the terminal
instead of mailed. It also answers CORS requests from the docs, so the
[interactive reference](./reference) can call it. Nothing leaves your machine.

## Start it

You need Node 20 or later and pnpm.

```sh
git clone https://github.com/codevibe-technology/codevibe-sign.git
cd codevibe-sign
pnpm install
pnpm build
pnpm --filter example-node-embed start
```

It prints what you need:

```text
API key: 3c2f0e…
Server on http://localhost:3000, envelope 7f3c9a2e-… sent.
CORS allowed for http://localhost:5173, http://localhost:4173, https://sign.codevibe.in
Signing link for asha@example.com: http://localhost:5173/?token=…
```

The server keeps running until you stop it with Ctrl+C. Everything is lost when it stops.

| Variable       | Default                                                                | Use                                        |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| `PORT`         | `3000`                                                                 | Port of the API.                           |
| `SIGN_API_KEY` | a new random key each run                                              | Sender API key; set it to keep one.        |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173,https://sign.codevibe.in` | Origins allowed to call the API, by comma. |

## Try it in the reference

1. Open the [reference](./reference). Under **Server**, keep `http://localhost:3000` or enter
   your own port.
2. Under **Authentication**, paste the printed API key as the bearer token.
3. Open **Create an envelope**, choose **Test Request** and send the example as it is: it
   carries a small real PDF. To use your own file, put it in `content` as base64
   (`base64 -i offer.pdf`).
4. Copy the envelope `id` into **Get an envelope**, **Audit log** or **Signing certificate**.
5. For the signing routes, take the token from a printed signing link and use it as `token`.
   Asha signs with a one-time code: call **Send a one-time code**, read the code from the
   terminal, verify it, and pass the returned `sessionToken` as `X-Sign-Session`.

The reference can only call the token routes directly. The `link` cookie flow needs the
signing page and the API on one origin, as the [React example](https://github.com/codevibe-technology/codevibe-sign/tree/main/examples/react-signing)
does with its dev proxy.

## Or use Postman or Insomnia

Import the [Postman collection](/codevibe-sign.postman_collection.json) (Insomnia imports it
too), set `apiKey` to the printed key, and send **Create an envelope**. The requests after it
pick up `envelopeId` and `docId` automatically. Desktop clients do not need CORS.

## With curl

```sh
KEY=<printed api key>
curl -s http://localhost:3000/health
curl -s -H "Authorization: Bearer $KEY" http://localhost:3000/v1/envelopes/<id>
```

## How CORS is added

The server itself sends no CORS headers. The sandbox puts a small Hono app in front of it:

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
