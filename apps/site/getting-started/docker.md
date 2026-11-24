---
title: Self-host with Docker
description: Run the Codevibe Sign web app with Docker Compose, or the standalone HTTP API as one container configured from environment variables.
---

# Self-host with Docker

## The whole web app

The web app (workspaces, sending, templates, bulk send, webhooks, the signing page and these
docs) runs with Docker Compose next to PostgreSQL, behind Traefik:

```sh
git clone https://github.com/codevibe-technology/codevibe-sign.git
cd codevibe-sign/deploy
cp .env.example .env    # host name, Traefik, database, secrets, SMTP; PLAN_MODE=self-hosted
docker compose pull web # the release named by SIGN_IMAGE_TAG in .env
docker compose up -d
```

Before the first start, create the seal certificate as described in the
[deployment runbook](https://github.com/codevibe-technology/codevibe-sign/blob/main/deploy/README.md),
which also covers DNS, backups, a restore drill and upgrades.

### The published image

Each release is published to GitHub Container Registry for `linux/amd64` and `linux/arm64`, so
nothing is compiled on your server:

```sh
docker pull ghcr.io/codevibe-technology/codevibe-sign:0.1.1
```

| Tag            | What it points at                      |
| -------------- | -------------------------------------- |
| `0.1.1`        | That release. Pin one in production.   |
| `0.1`          | The newest release of that minor line. |
| `latest`       | The newest release.                    |
| `sha-<commit>` | The release built from that commit.    |

`compose.yml` runs `ghcr.io/codevibe-technology/codevibe-sign:${SIGN_IMAGE_TAG}`, `latest`
when the variable is unset. Every image carries a signed build provenance attestation. With
the [GitHub CLI](https://cli.github.com/), check that an image was built by this repository's
release workflow before you run it:

```sh
gh attestation verify oci://ghcr.io/codevibe-technology/codevibe-sign:0.1.1 --owner codevibe-technology
```

### Building from source

To run your own changes or an unreleased commit, build the image on the server. The local
build takes the image name from `compose.yml`, so tag it with the commit rather than a release:

```sh
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose build web
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d
```

An image that is present locally is never pulled, so `up` runs your build. Set the same
`SIGN_IMAGE_TAG` in `.env` so later commands keep using it.

Email goes out through your SMTP account (`MAIL_TRANSPORT` set to an SMTP URL) or, for a
Microsoft 365 mailbox, through Microsoft Graph with an app registration instead of a password:

| Variable           | Required     | Notes                                                                         |
| ------------------ | ------------ | ----------------------------------------------------------------------------- |
| `MAIL_TRANSPORT`   | yes          | An SMTP URL such as `smtps://user:password@smtp.example.com:465`, or `graph`. |
| `MAIL_FROM`        | yes          | The sender, for example `Your Company <no-reply@example.com>`.                |
| `MS_TENANT_ID`     | with `graph` | The Directory (tenant) ID of the app registration.                            |
| `MS_CLIENT_ID`     | with `graph` | The Application (client) ID.                                                  |
| `MS_CLIENT_SECRET` | with `graph` | A client secret of the app. It needs the `Mail.Send` application permission.  |

The runbook's "Microsoft 365 (Graph)" section walks through the app registration.

### Workspaces and people

- Each workspace lives at `/dashboard/<address>`. The address is chosen when the workspace is
  created, and admins can change it later under **Settings → Workspace**, up to 5 times in 30
  days. The old address keeps redirecting to the new one, and no other workspace can take it
  for 90 days. API keys and webhooks use the workspace id and are not affected. If your
  reverse proxy rewrites or caches paths under `/dashboard`, let `308` redirects through.
- Each person sets their own name under **Personal settings**. It is the sender's name on the
  certificate and the public record of the envelopes they send.
- The app opens in the light theme. Each person can pick dark, or follow the system, under
  **Personal settings**.

### Aadhaar eSign and payments when you self-host

A self-hosted install is free and has no limits, no plans and no billing pages.

- **Aadhaar eSign** uses your own Leegality account. Each workspace can enter one under
  Settings, Aadhaar eSign, or you set one for the whole install with `LEEGALITY_API_KEY`,
  `LEEGALITY_PRIVATE_SALT`, `LEEGALITY_WORKFLOW_ID` and `LEEGALITY_BASE_URL`. Leegality bills
  you directly; there are no credits. See
  [Aadhaar eSign with Leegality](/guides/aadhaar-leegality).
- **Invoices are never issued in Codevibe's name.** The seller on an invoice is whoever your
  own `INVOICE_SELLER_*` settings name, and nothing is built in.
- **Selling from your own install** is possible: set `PLAN_MODE=hosted`, your Razorpay keys and
  your seller details. Section 12 of the runbook lists every setting and how to go from test
  keys to live ones.

## The HTTP API on its own

`apps/server` builds a Docker image of the standalone service. It reads all of its
configuration from environment variables, migrates the PostgreSQL database on start and stores
files in a volume.

### Pull and run

Each release is published as `ghcr.io/codevibe-technology/codevibe-sign-server`, with the same
tags and attestation as the web app image above:

```sh
docker pull ghcr.io/codevibe-technology/codevibe-sign-server:0.1.1
gh attestation verify oci://ghcr.io/codevibe-technology/codevibe-sign-server:0.1.1 --owner codevibe-technology
docker run -d --name sign -p 3000:3000 --env-file sign.env -v sign-data:/data \
  ghcr.io/codevibe-technology/codevibe-sign-server:0.1.1
```

To build it yourself instead, from the repository root:

```sh
docker build -f apps/server/Dockerfile -t codevibe-sign-server .
docker run -d --name sign -p 3000:3000 --env-file sign.env -v sign-data:/data codevibe-sign-server
```

The image runs as the unprivileged `node` user, stores files under `/data` and checks
`GET /health` every 30 seconds. Put it behind a reverse proxy that terminates TLS.

### Environment

| Variable                 | Required | Default           | Notes                                                                                                                             |
| ------------------------ | -------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | yes      |                   | PostgreSQL, `postgres://` or `postgresql://`.                                                                                     |
| `PUBLIC_URL`             | yes      |                   | Base URL used in signing links. `https`, or `http` for localhost only.                                                            |
| `API_KEYS`               | yes      |                   | Comma-separated keys for your backend, each at least 32 characters.                                                               |
| `SEAL_P12_BASE64`        | yes      |                   | Your sealing certificate and key as a base64 PKCS#12 file.                                                                        |
| `SEAL_P12_PASSPHRASE`    | yes      |                   | May be empty, but must be set.                                                                                                    |
| `SMTP_HOST`              | yes      |                   |                                                                                                                                   |
| `SMTP_FROM`              | yes      |                   | For example `Sign <sign@example.com>`.                                                                                            |
| `SMTP_PORT`              | no       | `587`             |                                                                                                                                   |
| `SMTP_SECURE`            | no       | port is 465       | `true` for implicit TLS.                                                                                                          |
| `SMTP_USER`, `SMTP_PASS` | no       |                   | Set both or neither.                                                                                                              |
| `FILES_DIR`              | no       | `/data/files`     | Where documents and sealed files are stored.                                                                                      |
| `SEAL_REASON`            | no       |                   | Reason written into the PDF seal.                                                                                                 |
| `SEAL_LOCATION`          | no       |                   | Location written into the PDF seal.                                                                                               |
| `SEAL_TSA_URL`           | no       |                   | RFC 3161 timestamp authority, for example `http://timestamp.digicert.com`. Seals then carry a timestamp.                          |
| `SEAL_TSA_REQUIRED`      | no       | `true`            | With `SEAL_TSA_URL`: `false` seals without a timestamp when the authority fails, and logs a warning.                              |
| `TICK_INTERVAL_SECONDS`  | no       | `60`              | How often reminders, expiry and retries run (5 to 3600).                                                                          |
| `TRUST_PROXY`            | no       | `false`           | `true` to read client IPs from `X-Forwarded-For` behind your proxy.                                                               |
| `TIME_ZONE`              | no       | UTC               | IANA time zone, for example `Asia/Kolkata`, for the dates printed on signed documents and the local time on the certificate page. |
| `TRUSTED_PROXY_HOPS`     | no       | `1`               | Proxies in front of the server; the client IP is that many entries from the right of `X-Forwarded-For`.                           |
| `PORT`, `HOST`           | no       | `3000`, `0.0.0.0` |                                                                                                                                   |

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

### Operating it

- Back up the PostgreSQL database and the files volume together. The audit log lives in the
  database and refers to files by key.
- Keep the PKCS#12 file and its passphrase out of version control and logs. Anyone with the key
  can seal files in your name.
- The service stops accepting requests, finishes in-flight requests and background jobs and
  closes its database connections on `SIGTERM` and `SIGINT`, so rolling restarts are safe.
- Behind a reverse proxy, set `TRUST_PROXY=true` so rate limits and the audit log see the
  client's address rather than the proxy's.

## Next

[Operate an install](/self-host/operate)
