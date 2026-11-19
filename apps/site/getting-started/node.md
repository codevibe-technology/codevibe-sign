---
title: Embed in Node
description: Start the Codevibe Sign server inside your own Node application and call its HTTP API from your backend.
---

# Embed in Node

If you already run a Node backend, you can start the signing server inside it instead of
running a separate container.

```sh
pnpm add @codevibe_technology/sign-server
```

```ts check
import { readFile } from 'node:fs/promises';
import { startSignServer } from '@codevibe_technology/sign-server';

const sign = await startSignServer({
  databaseUrl: process.env.DATABASE_URL!,
  filesDir: './data/files',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'sign',
    pass: process.env.SMTP_PASS!,
    from: 'Sign <sign@example.com>',
  },
  seal: { p12: await readFile('./seal.p12'), passphrase: process.env.SEAL_P12_PASSPHRASE! },
  apiKeys: [process.env.SIGN_API_KEY!],
  publicUrl: 'https://sign.example.com',
});

await sign.listen(3000);
```

`startSignServer` migrates the database, then serves the API. Your backend creates and sends
envelopes through the [HTTP API](/api/server#sending) with one of the API keys. The service
answers `GET /health` without authentication, runs reminders, expiry and retries on a timer,
and `sign.close()` stops accepting requests, lets in-flight work finish and disconnects.

## Options

| Option           | What it is                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `databaseUrl`    | PostgreSQL connection string.                                                                                                                                                             |
| `filesDir`       | Directory for original and sealed files.                                                                                                                                                  |
| `smtp`           | `{ host, port, secure, user?, pass?, from }` for invitations and codes.                                                                                                                   |
| `seal`           | `{ p12, passphrase, reason?, location? }`: your sealing certificate as PKCS#12 bytes. The server refuses to start with a key under RSA-2048, a SHA-1 certificate or one that has expired. |
| `apiKeys`        | Keys your backend sends to call the API. Use long random values.                                                                                                                          |
| `publicUrl`      | The base URL recipients open; signing links are built from it.                                                                                                                            |
| `tickIntervalMs` | How often reminders, expiry and retries run. Default 60 seconds.                                                                                                                          |

A second argument replaces any adapter or option `createSignServer` takes, for example
`{ webhooks: [...], trustProxy: true, trustedProxyHops: 1 }`.

## Mounting the app yourself

`createSignServer(options)` returns `{ app, tick, idle }` without starting anything. `app` is a
[Hono](https://hono.dev) app you can mount in your own server; call `tick()` every minute. You
bring the adapters:

```ts check
import { readFile } from 'node:fs/promises';
import {
  createSignServer,
  listen,
  localFileStore,
  mailOtpSender,
  migrate,
  postgresStore,
  smtpMailer,
} from '@codevibe_technology/sign-server';

const store = postgresStore(process.env.DATABASE_URL!);
await migrate(store.sql);
const mailer = smtpMailer({ transport: process.env.SMTP_URL!, from: 'Sign <sign@example.com>' });

const sign = createSignServer({
  store,
  files: localFileStore('./data/files'),
  mailer,
  otp: mailOtpSender(mailer),
  sealer: { p12: await readFile('./seal.p12'), passphrase: process.env.SEAL_P12_PASSPHRASE! },
  apiKeys: [process.env.SIGN_API_KEY!],
  publicUrl: 'https://sign.example.com',
});

await listen(sign.app, { port: 3000 });
setInterval(() => void sign.tick(), 60_000);
```

## Using only the rules

If you want your own storage, mail and HTTP layer, use `@codevibe_technology/sign-core` directly. Every
step is a pure function that returns the new envelope, the audit events and the effects to
perform. See [Send your first envelope](/guides/first-envelope).
