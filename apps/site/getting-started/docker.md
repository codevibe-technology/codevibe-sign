---
title: Self-host with Docker
description: Build and run the standalone Codevibe Sign service with Docker, configured entirely from environment variables.
---

# Self-host with Docker

`apps/server` builds a Docker image of the standalone service. It reads all of its
configuration from environment variables, migrates the PostgreSQL database on start and stores
files in a volume.

## Build and run

From the repository root:

```sh
docker build -f apps/server/Dockerfile -t codevibe-sign .
docker run -d --name sign -p 3000:3000 --env-file sign.env -v sign-data:/data codevibe-sign
```

The image runs as the unprivileged `node` user, stores files under `/data` and checks
`GET /health` every 30 seconds. Put it behind a reverse proxy that terminates TLS.

## Environment

| Variable                 | Required | Default           | Notes                                                                                                   |
| ------------------------ | -------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | yes      |                   | PostgreSQL, `postgres://` or `postgresql://`.                                                           |
| `PUBLIC_URL`             | yes      |                   | Base URL used in signing links. `https`, or `http` for localhost only.                                  |
| `API_KEYS`               | yes      |                   | Comma-separated keys for your backend, each at least 32 characters.                                     |
| `SEAL_P12_BASE64`        | yes      |                   | Your sealing certificate and key as a base64 PKCS#12 file.                                              |
| `SEAL_P12_PASSPHRASE`    | yes      |                   | May be empty, but must be set.                                                                          |
| `SMTP_HOST`              | yes      |                   |                                                                                                         |
| `SMTP_FROM`              | yes      |                   | For example `Sign <sign@example.com>`.                                                                  |
| `SMTP_PORT`              | no       | `587`             |                                                                                                         |
| `SMTP_SECURE`            | no       | port is 465       | `true` for implicit TLS.                                                                                |
| `SMTP_USER`, `SMTP_PASS` | no       |                   | Set both or neither.                                                                                    |
| `FILES_DIR`              | no       | `/data/files`     | Where documents and sealed files are stored.                                                            |
| `SEAL_REASON`            | no       |                   | Reason written into the PDF seal.                                                                       |
| `SEAL_LOCATION`          | no       |                   | Location written into the PDF seal.                                                                     |
| `TICK_INTERVAL_SECONDS`  | no       | `60`              | How often reminders, expiry and retries run (5 to 3600).                                                |
| `TRUST_PROXY`            | no       | `false`           | `true` to read client IPs from `X-Forwarded-For` behind your proxy.                                     |
| `TRUSTED_PROXY_HOPS`     | no       | `1`               | Proxies in front of the server; the client IP is that many entries from the right of `X-Forwarded-For`. |
| `PORT`, `HOST`           | no       | `3000`, `0.0.0.0` |                                                                                                         |

All problems are reported together at start-up, by variable name only. Values are never printed.

A minimal `sign.env`:

```sh
DATABASE_URL=postgres://sign:secret@db:5432/sign
PUBLIC_URL=https://sign.example.com
API_KEYS=replace-with-a-random-key-of-at-least-32-characters
SEAL_P12_BASE64=MIIK...
SEAL_P12_PASSPHRASE=
SMTP_HOST=smtp.example.com
SMTP_FROM=Sign <sign@example.com>
```

To turn a `.p12` file into the base64 value: `base64 -i seal.p12 | tr -d '\n'`.

## Operating it

- Back up the PostgreSQL database and the files volume together. The audit log lives in the
  database and refers to files by key.
- Keep the PKCS#12 file and its passphrase out of version control and logs. Anyone with the key
  can seal files in your name.
- The service stops accepting requests, finishes in-flight requests and background jobs and
  closes its database connections on `SIGTERM` and `SIGINT`, so rolling restarts are safe.
- Behind a reverse proxy, set `TRUST_PROXY=true` so rate limits and the audit log see the
  client's address rather than the proxy's.
