---
title: Embed in Node
description: Start the Codevibe Sign server inside your own Node application and call its HTTP API from your backend.
---

# Embed in Node

If you already run a Node backend, you can start the signing server inside it instead of
running a separate container.

::: warning Pre-release
`@codevibe/sign-server` is still being built. The code below is the planned API; option names
may change before 0.1.
:::

```sh
pnpm add @codevibe/sign-server
```

```ts
import { readFile } from 'node:fs/promises';
import { createSignServer } from '@codevibe/sign-server';

const server = createSignServer({
  databaseUrl: process.env.DATABASE_URL,
  filesDir: './data/files',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    user: 'sign',
    pass: process.env.SMTP_PASS,
    from: 'Sign <sign@example.com>',
  },
  seal: { p12: await readFile('./seal.p12'), passphrase: process.env.SEAL_P12_PASSPHRASE },
  apiKeys: [process.env.SIGN_API_KEY],
  publicUrl: 'https://sign.example.com',
});

await server.listen(3000);
```

Your backend then creates and sends envelopes through the HTTP API with one of the API keys.
The service answers `GET /health` without authentication, and `server.close()` stops accepting
requests and lets in-flight work finish.

## Options

| Option        | What it is                                                                |
| ------------- | ------------------------------------------------------------------------- |
| `databaseUrl` | PostgreSQL connection string.                                             |
| `filesDir`    | Directory for original and sealed files.                                  |
| `smtp`        | `{ host, port, secure?, user?, pass?, from }` for invitations and codes.  |
| `seal`        | `{ p12, passphrase }`: your sealing certificate and key as PKCS#12 bytes. |
| `apiKeys`     | Keys your backend sends to call the API. Use long random values.          |
| `publicUrl`   | The base URL recipients open; signing links are built from it.            |

## Using only the rules

If you want your own storage, mail and HTTP layer, use `@codevibe/sign-core` directly. Every
step is a pure function that returns the new envelope, the audit events and the effects to
perform. See [Send your first envelope](/guides/first-envelope).
