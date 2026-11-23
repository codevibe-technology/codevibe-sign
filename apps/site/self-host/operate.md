---
title: Operate an install
description: Every setting of a self-hosted Codevibe Sign install grouped by purpose, how to change a secret and restart, run migrations, set a plan by hand, back up, restore and upgrade.
---

# Operate an install

This page is for the person who runs a Codevibe Sign server with the files in `deploy/`. To
install it the first time, follow [Self-host with Docker](/getting-started/docker) and the
[deployment runbook](https://github.com/codevibe-technology/codevibe-sign/blob/main/deploy/README.md),
which has the full commands for DNS and the seal certificate.

All the commands below run in the folder that holds `compose.yml` and `.env`.

## Settings

Every setting lives in `.env`, copied from `.env.example`. After a change, run `./restart.sh`.
A setting that is set but malformed is named in the logs and in `/api/health`.

### Address and proxy

| Variable               | What it is                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `SIGN_HOST`            | The host name the app is served at, for example `sign.example.com`. DNS must point here. |
| `TRAEFIK_NETWORK`      | The external Docker network your Traefik watches.                                        |
| `TRAEFIK_ENTRYPOINT`   | Traefik's HTTPS entrypoint, usually `websecure`.                                         |
| `TRAEFIK_CERTRESOLVER` | The certificate resolver configured in Traefik, for example your Let's Encrypt one.      |
| `SIGN_IMAGE_TAG`       | The tag `docker compose build` gives the image, for example a release or a commit.       |

`compose.yml` derives `APP_URL` (`https://<SIGN_HOST>`), `DATABASE_URL`, `FILES_DIR`,
`SEAL_P12_PATH` and `TRUST_PROXY` from these; you do not set them yourself.

### Database and secrets

| Variable              | What it is                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER`       | The database user. Default `sign`.                                                                                                         |
| `POSTGRES_PASSWORD`   | The database password. Letters and digits only: it goes into a URL.                                                                        |
| `POSTGRES_DB`         | The database name. Default `sign`.                                                                                                         |
| `AUTH_SECRET`         | Signs sessions and sign-in links. At least 32 characters (`openssl rand -hex 32`).                                                         |
| `SIGN_SESSION_SECRET` | Signs signer sessions. At least 32 characters.                                                                                             |
| `SECRETS_KEY`         | Encrypts the eSign provider details workspaces save. Defaults to a key from `AUTH_SECRET`. Changing either makes saved details unreadable. |

### Seal

| Variable            | What it is                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SEAL_PASSPHRASE`   | The passphrase of `secrets/seal.p12`, the certificate that seals signed PDFs.                                                           |
| `SEAL_TSA_URL`      | An RFC 3161 timestamp authority, such as `http://timestamp.digicert.com`, so each seal carries a trusted time. Empty seals without one. |
| `SEAL_TSA_REQUIRED` | With a URL set, sealing waits and retries while the authority is down. `false` seals without the timestamp instead.                     |
| `SIGN_TIME_ZONE`    | The default zone for dates on documents and in emails, such as `Asia/Kolkata`. UTC when unset. Each workspace can choose its own.       |

### Email and sign-in

| Variable                                           | What it is                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `MAIL_TRANSPORT`                                   | An SMTP URL such as `smtps://user:password@smtp.example.com:465`, or `graph` for Microsoft 365. Nothing is sent until it is set. |
| `MAIL_FROM`                                        | The sender people see, for example `Your Company <no-reply@example.com>`.                                                        |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | The Microsoft 365 app registration, with `MAIL_TRANSPORT=graph`.                                                                 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`         | Optional **Continue with Google**. Redirect URI: `https://<SIGN_HOST>/api/auth/callback/google`.                                 |

### How the install behaves

| Variable            | What it is                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PLAN_MODE`         | `self-hosted`: no limits and no plan or billing screens. `hosted`: plans, limits and billing, as on sign.codevibe.in. |
| `FREE_PLAN_LIMITS`  | Hosted only. JSON that changes Free plan limits, for example `{"envelopesPerMonth":20}`.                              |
| `SINGLE_WORKSPACE`  | `true`: one workspace, and people join by invitation only.                                                            |
| `AUTO_MIGRATE`      | `true`: bring the database up to date each time the app starts. Safe to leave on.                                     |
| `SIGN_TICK_SECONDS` | How often reminders, expiry and retries run. Default `60`.                                                            |

### Payments and invoices

All optional. Without them nothing is sold and the app shows "coming soon" where something
would be. Set the secret ones with `./set-secret.sh`.

| Variable                                                                                                             | What it is                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`                                                                             | Razorpay API keys. `rzp_test_` keys never move money and the app shows "Test mode".                     |
| `RAZORPAY_WEBHOOK_SECRET`                                                                                            | The secret of the Razorpay webhook at `https://<SIGN_HOST>/api/billing/razorpay/webhook`.               |
| `BILLING_LIVE`                                                                                                       | `true` once real money is taken; test keys and the eSign sandbox are then refused.                      |
| `INVOICE_SELLER_NAME`, `INVOICE_SELLER_GSTIN`, `INVOICE_SELLER_ADDRESS`                                              | Who issues invoices: your company. Nothing is built in.                                                 |
| `INVOICE_SELLER_CIN`, `INVOICE_SELLER_PAN`, `INVOICE_SELLER_PHONE`, `INVOICE_SELLER_EMAIL`, `INVOICE_SELLER_WEBSITE` | Optional lines of the invoice header.                                                                   |
| `INVOICE_UPI_ID`                                                                                                     | Printed as a "Pay using UPI" QR code.                                                                   |
| `INVOICE_BANK_NAME`, `INVOICE_BANK_HOLDER`, `INVOICE_BANK_ACCOUNT`, `INVOICE_BANK_IFSC`, `INVOICE_BANK_BRANCH`       | Bank details on the invoice; the branch is optional.                                                    |
| `INVOICE_LOGO_PATH`, `INVOICE_SIGNATURE_PATH`                                                                        | PNG or JPEG files inside the container, for example `/data/branding/logo.png`.                          |
| `INVOICE_SERIES`                                                                                                     | Invoice numbers. Default `CV-{FY}`, giving `CV-2026270001`.                                             |
| `CREDIT_NOTE_SERIES`, `PROFORMA_SERIES`                                                                              | Reserved number series, default `CVCN-{FY}` and `CVPI-{FY}`.                                            |
| `INVOICE_SAC`                                                                                                        | The SAC code on invoices. Default `997331`.                                                             |
| `GST_PERCENT`                                                                                                        | GST added to every price. Default `18`.                                                                 |
| `CLOUD_PRICE_INR`, `CLOUD_INCLUDED_MEMBERS`, `CLOUD_EXTRA_MEMBER_INR`                                                | The Cloud plan a month, the members included and each extra member. Default `999`, `25`, `99`.          |
| `CLOUD_ANNUAL_MONTHS`, `CLOUD_GRACE_DAYS`                                                                            | Months charged for a year, and days after a missed renewal before Free limits apply. Default `10`, `7`. |
| `INSTALL_HELP_PRICE_INR`                                                                                             | The installation help service. Default `1999`.                                                          |
| `ORDER_PAYMENT_WINDOW_MINUTES`                                                                                       | How long after an order opens a payment for it is honoured. Default `30`.                               |
| `OPERATOR_EMAIL`                                                                                                     | Where notices for you go: bookings, refunds, payments that could not be applied.                        |
| `HOSTING_OFFERS`                                                                                                     | JSON list of `{"name","url"}` links shown under "Need a server?". Hidden while empty.                   |

### Aadhaar eSign

| Variable                                                               | What it is                                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `LEEGALITY_API_KEY`, `LEEGALITY_PRIVATE_SALT`, `LEEGALITY_WORKFLOW_ID` | Your Leegality account for the whole install: the Auth Token, Private Salt and Workflow ID.                                                     |
| `LEEGALITY_BASE_URL`                                                   | `https://app1.leegality.com/api` for production. Unset means the sandbox.                                                                       |
| `ESIGN_PROVIDER_COST_INR`                                              | Hosted mode: what one eSign costs you. Nothing can be bought until it is set.                                                                   |
| `ESIGN_MARKUP_INR`                                                     | Hosted mode: added to the cost on the Free plan. Default `10`.                                                                                  |
| `CREDIT_PACKS`                                                         | The credit packs offered. Default `10,50,200`.                                                                                                  |
| `ESIGN_SESSION_HOURS`                                                  | How long a started eSign is waited for and its credit held. Default `24`; at least as long as your Leegality workflow keeps an invitation open. |

Workspaces can also enter their own Leegality account under **Settings, Aadhaar eSign**; see
[Aadhaar eSign settings](/admin/aadhaar-esign).

## Change a secret and restart

`set-secret.sh` writes one variable to `.env` and asks for the value with the input hidden,
so it never shows on screen, in the shell history or in the process list. The old file is
kept as `.env.bak-<time>`.

```sh
./set-secret.sh RAZORPAY_KEY_SECRET   # paste the value, press Enter
./restart.sh                          # starts the app again, waits until it is healthy
```

`./set-secret.sh --unset NAME` removes a variable. `restart.sh` builds nothing and takes
under a minute; it prints `web is healthy` when done.

## Health

```sh
curl -fsS https://<SIGN_HOST>/api/health
docker compose ps
docker compose logs -f web
```

`/api/health` answers with `"ok": true` while the app and its database work, and lists any
billing setting that is wrong under `billing.problems`.

## Migrations

With `AUTO_MIGRATE=true` the database is brought up to date at every start. To run them by
hand, for example before an upgrade with `AUTO_MIGRATE=false`:

```sh
docker compose exec web node ops/migrate.mjs
```

It prints what it applied, or "Database is up to date."

## Set a plan by hand

On a hosted install, move an account to `free`, `cloud` or `unlimited`, for example for a
partner or a customer who paid by bank transfer:

```sh
docker compose exec -e PLAN_CHANGED_BY="ops:$USER" web node ops/plan-set.mjs <workspace address or owner email> cloud
```

The command finds the account from one of its workspaces or its owner's email, moves all its
workspaces together, prints them and records who made the change. A plan set by hand ends any
paid term and from then on billing leaves the plan alone; set it back to `free` to let the
account buy a plan again.

## Backups

Back up the database and the files together, at least daily, and copy them off the server:

```sh
mkdir -p backups
stamp=$(date +%F-%H%M)
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/db-$stamp.dump"
docker run --rm -v codevibe-sign_sign-files:/data:ro -v "$PWD/backups":/backup alpine:3.20 \
  tar czf "/backup/files-$stamp.tgz" -C /data .
```

Run it from cron, keep at least 14 days and sync `backups/` to another machine. `.env` and
`secrets/seal.p12` are not in these files: keep them in your secrets store. Practise a
restore into a scratch database once, then every quarter; the runbook's "Restore drill" has
the commands.

## Upgrades

```sh
git fetch --tags && git checkout <release-tag>
# take a backup first
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose build web
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d web
```

Migrations run on start. Then check `/api/health`, sign in and send yourself a document. Set
`SIGN_IMAGE_TAG` in `.env` to the new tag. Migrations only move forward: to roll back, build
the previous release and restore the backup taken before the upgrade. Read the
[changelog](/changelog) before each upgrade.

## Next

[Security](/security)
