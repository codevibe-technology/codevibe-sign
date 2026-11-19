---
title: '@codevibe/sign-server'
description: API reference for @codevibe/sign-server - the HTTP API and runtime that stores envelopes, sends invitations and codes, fires webhooks and seals files.
---

# @codevibe/sign-server

<ComingSoon pkg="@codevibe/sign-server" />

The HTTP API and runtime. It stores envelopes, sends invitations and one-time codes, runs
signing sessions, fires webhooks and produces the sealed file, with adapters for storage,
files, mail and OTP delivery.

```sh
pnpm add @codevibe/sign-server
```

Depends on `@codevibe/sign-core`, `@codevibe/sign-pdf` and `hono`.

## `createSignServer(config)`

Returns, or resolves to, `{ listen(port, host?), close() }`.

| Option        | Type                                         |
| ------------- | -------------------------------------------- |
| `databaseUrl` | `string`, PostgreSQL                         |
| `filesDir`    | `string`                                     |
| `smtp`        | `{ host, port, secure, user?, pass?, from }` |
| `seal`        | `{ p12: Uint8Array, passphrase: string }`    |
| `apiKeys`     | `string[]`                                   |
| `publicUrl`   | `string`, the base URL used in signing links |

- `GET /health` answers 200 without authentication when the service can take requests.
- `close()` stops accepting requests and finishes in-flight work.

See [Embed in Node](/getting-started/node) and [Self-host with Docker](/getting-started/docker).

## HTTP API

The endpoints for creating, sending and tracking envelopes will be listed here from the package
README when it is merged.

## Webhooks

See [Webhooks](/guides/webhooks).
