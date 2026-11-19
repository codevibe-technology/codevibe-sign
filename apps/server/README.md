# Codevibe Sign server

The standalone Codevibe Sign service as a Docker image. It reads its configuration from
environment variables and runs `@codevibe/sign-server`.

> Status: this entry is written against the planned `createSignServer` API of
> `@codevibe/sign-server` and starts once that package exports it. Until then it validates the
> configuration and exits with a clear error.

## Build and run

From the repository root:

```sh
docker build -f apps/server/Dockerfile -t codevibe-sign .
docker run -d --name sign -p 3000:3000 --env-file sign.env -v sign-data:/data codevibe-sign
```

The image runs as the unprivileged `node` user, stores files under `/data` and checks
`GET /health` every 30 seconds. Put it behind a TLS-terminating proxy.

## Environment

| Variable                 | Required | Default           | Notes                                                                  |
| ------------------------ | -------- | ----------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`           | yes      |                   | PostgreSQL, `postgres://` or `postgresql://`.                          |
| `PUBLIC_URL`             | yes      |                   | Base URL used in signing links. `https`, or `http` for localhost only. |
| `API_KEYS`               | yes      |                   | Comma-separated keys for your backend, each at least 32 characters.    |
| `SEAL_P12_BASE64`        | yes      |                   | Your sealing certificate and key as a base64 PKCS#12 file.             |
| `SEAL_P12_PASSPHRASE`    | yes      |                   | May be empty, but must be set.                                         |
| `SMTP_HOST`              | yes      |                   |                                                                        |
| `SMTP_FROM`              | yes      |                   | For example `Sign <sign@example.com>`.                                 |
| `SMTP_PORT`              | no       | `587`             |                                                                        |
| `SMTP_SECURE`            | no       | port is 465       | `true` for implicit TLS.                                               |
| `SMTP_USER`, `SMTP_PASS` | no       |                   | Set both or neither.                                                   |
| `FILES_DIR`              | no       | `/data/files`     | Where documents and sealed files are stored.                           |
| `PORT`, `HOST`           | no       | `3000`, `0.0.0.0` |                                                                        |

All problems are reported together at start-up, by variable name only; values are never
printed.

## What it expects from `@codevibe/sign-server`

- `createSignServer(config)` returning (or resolving to) `{ listen(port, host): Promise<void>; close(): Promise<void> }`.
- `config` shaped as `SignServerConfig` in [src/config.ts](src/config.ts):
  `{ databaseUrl, filesDir, smtp: { host, port, secure, user?, pass?, from }, seal: { p12: Uint8Array, passphrase }, apiKeys: string[], publicUrl }`.
- `GET /health` answering 200 when the service can take requests, without authentication.
- `close()` stops accepting requests and finishes in-flight work; the entry calls it on
  `SIGTERM` and `SIGINT`.

## Licence

Apache-2.0 © Codevibe
