# Codevibe Sign server

The standalone Codevibe Sign service as a Docker image. It reads its configuration from
environment variables and runs `startSignServer` from `@codevibe_technology/sign-server`: PostgreSQL
(migrated on start), documents on disk, SMTP email and email one-time codes.

Without Docker, `npx @codevibe_technology/sign-server start` runs the same service from the
same variables.

## Pull and run

Each release is published to GitHub Container Registry for `linux/amd64` and `linux/arm64`,
tagged with the version (`0.1.1`), its minor line (`0.1`), `latest` and `sha-<commit>`:

```sh
docker pull ghcr.io/codevibe-technology/codevibe-sign-server:0.1.1
docker run -d --name sign -p 3000:3000 --env-file sign.env -v sign-data:/data \
  ghcr.io/codevibe-technology/codevibe-sign-server:0.1.1
```

Each image carries a signed build provenance attestation. Check it with the GitHub CLI:

```sh
gh attestation verify oci://ghcr.io/codevibe-technology/codevibe-sign-server:0.1.1 --owner codevibe-technology
```

To build it yourself instead, from the repository root:

```sh
docker build -f apps/server/Dockerfile -t codevibe-sign-server .
docker run -d --name sign -p 3000:3000 --env-file sign.env -v sign-data:/data codevibe-sign-server
```

The image runs as the unprivileged `node` user, stores files under `/data` and checks
`GET /health` every 30 seconds. Put it behind a TLS-terminating proxy.

## Environment

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

All problems are reported together at start-up, by variable name only; values are never
printed.

## Running

- `GET /health` answers `200 {"ok":true}` without authentication; the image's health check
  uses it.
- On `SIGTERM` or `SIGINT` the service stops accepting requests, waits for in-flight requests
  and background jobs, closes the database pool and exits 0 (1 if closing fails).
- Run one process per database unless you also share rate limits and a session secret; see
  the `@codevibe_technology/sign-server` readme.

## Licence

AGPL-3.0-only © Codevibe. See [LICENSING.md](../../LICENSING.md).
