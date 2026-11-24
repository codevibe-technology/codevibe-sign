# Deploying Codevibe Sign

This folder runs the web app (the app, the HTTP API and the docs at `/docs`) and PostgreSQL
with Docker Compose, behind a Traefik that already runs on the server and owns ports 80 and 443. The same files serve the Codevibe cloud at `sign.codevibe.in` (`PLAN_MODE=hosted`) and
a self-hosted install (`PLAN_MODE=self-hosted`).

| File            | What it is                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `compose.yml`   | The `web` service (the published image, or built from `apps/web/Dockerfile`) and `db` (PostgreSQL). |
| `.env.example`  | Every setting, with notes. Copy it to `.env`.                                                       |
| `secrets/`      | `seal.p12`, the certificate that seals signed PDFs. Never committed.                                |
| `set-secret.sh` | Sets one variable in `.env` without showing its value (step 12).                                    |
| `restart.sh`    | Starts the app again with the current `.env`, without building (step 12).                           |

Data lives in two named volumes: `codevibe-sign_sign-db` (the database) and
`codevibe-sign_sign-files` (uploaded and sealed PDFs, logos). Both must be backed up.

## 1. Before you start

- A Linux server with Docker Engine 24+ and the Compose plugin, at least 2 GB of RAM and
  10 GB of free disk.
- Traefik v2 or v3 running in Docker, with an HTTPS entrypoint (usually `websecure`), a
  certificate resolver (for example Let's Encrypt), and an external Docker network it
  watches. Note the network's name (`docker network ls`) and the resolver's name from the
  Traefik configuration.
- An SMTP account that may send from the address in `MAIL_FROM`, with SPF and DKIM set up
  for its domain, or a Microsoft 365 mailbox (see "Microsoft 365 (Graph)" in step 3).

## 2. DNS

Point the host name at the server, then wait until it resolves:

```sh
# At your DNS provider: an A record (and AAAA for IPv6)
#   sign.codevibe.in  A  <server IPv4>
dig +short sign.codevibe.in
```

Traefik asks Let's Encrypt for the certificate the first time the app starts, which only
works once this answers with the server's address.

## 3. Get the code and the settings

```sh
sudo mkdir -p /opt/codevibe-sign && sudo chown "$USER" /opt/codevibe-sign
git clone https://github.com/codevibe-technology/codevibe-sign.git /opt/codevibe-sign
cd /opt/codevibe-sign/deploy
cp .env.example .env
chmod 600 .env
```

Fill in `.env`:

```sh
openssl rand -hex 24   # POSTGRES_PASSWORD (letters and digits only, it goes into a URL)
openssl rand -hex 32   # AUTH_SECRET
openssl rand -hex 32   # SIGN_SESSION_SECRET
openssl rand -hex 24   # SEAL_PASSPHRASE
```

Set `SIGN_HOST`, `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERTRESOLVER`,
`MAIL_TRANSPORT` and `MAIL_FROM`. For the Codevibe cloud keep `PLAN_MODE=hosted`; for your
own company's install use `PLAN_MODE=self-hosted` (and `SINGLE_WORKSPACE=true` if only one
workspace should ever exist).

### Microsoft 365 (Graph)

Microsoft is switching off password (basic auth) SMTP, app passwords included. To send from a
Microsoft 365 mailbox, let the app sign in on its own through Microsoft Graph instead. A
password change on the mailbox then has no effect on sending.

1. In the Entra admin center, open **App registrations > New registration**. Name it (for
   example `Codevibe Sign mail`), keep "Accounts in this organizational directory only", no
   redirect URI.
2. **API permissions > Add a permission > Microsoft Graph > Application permissions**, pick
   `Mail.Send`, then **Grant admin consent**.
3. **Certificates & secrets > New client secret**. Copy the value now; it is shown once. Note
   when it expires and put a reminder in the calendar.
4. From **Overview**, copy the Application (client) ID and the Directory (tenant) ID.

Then in `.env`:

```sh
MAIL_TRANSPORT=graph
MAIL_FROM=Your Company <no-reply@example.com>   # the mailbox to send as
MS_TENANT_ID=<Directory (tenant) ID>
MS_CLIENT_ID=<Application (client) ID>
MS_CLIENT_SECRET=<client secret value>
```

The mailbox in `MAIL_FROM` must exist in the tenant (a licensed or shared mailbox). Sent mail is
not kept in its Sent Items. Completed copies over 2 MB go out as download links, because Graph
takes about 4 MB per message once attachments are encoded.

`Mail.Send` granted in Entra lets the app send as any mailbox in the tenant. To allow only the
one mailbox, use RBAC for Applications in Exchange Online instead, and then remove the
`Mail.Send` grant from the app registration (the Entra grant applies on top of the scope):

```powershell
Connect-ExchangeOnline
# ObjectId: Enterprise applications > your app > Object ID (not the app registration's)
New-ServicePrincipal -AppId <client id> -ObjectId <enterprise app object id> -DisplayName "Codevibe Sign mail"
New-ManagementScope -Name "Codevibe Sign mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'no-reply@example.com'"
New-ManagementRoleAssignment -App <client id> -Role "Application Mail.Send" -CustomResourceScope "Codevibe Sign mailbox"
Test-ServicePrincipalAuthorization -Identity <client id> -Resource no-reply@example.com
```

When a send fails, Settings > Email log and the app logs say what to fix: a wrong or expired
client secret, a wrong client or tenant ID, a missing permission or consent, or a mailbox that
does not exist. Busy responses from Microsoft are retried like any other failed send.

## 4. Seal certificate

Every completed document is sealed with this certificate. The recommended setup is a small
private root that issues the seal certificate: readers who trust the root keep trusting new
seal keys after a rotation. Create both on the server, so the seal key never travels:

```sh
cd /opt/codevibe-sign/deploy
mkdir -p secrets && chmod 700 secrets && cd secrets
export SEAL_PASSPHRASE="$(grep '^SEAL_PASSPHRASE=' ../.env | cut -d= -f2-)"

# The private root, once. It only issues seal certificates.
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -noenc \
  -keyout root.key -out root.crt \
  -subj "/CN=Codevibe Sign Root/O=Codevibe Technology/C=IN" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

# The seal certificate, issued by the root: an end-entity certificate for document signing.
printf '%s\n' \
  'basicConstraints=critical,CA:FALSE' \
  'keyUsage=critical,digitalSignature,nonRepudiation' \
  'extendedKeyUsage=1.3.6.1.5.5.7.3.36,1.3.6.1.4.1.311.10.3.12' \
  'subjectKeyIdentifier=hash' \
  'authorityKeyIdentifier=keyid' > seal.ext
openssl req -new -newkey rsa:3072 -sha256 -noenc -keyout seal.key -out seal.csr \
  -subj "/CN=Codevibe Sign/O=Codevibe Technology/C=IN"
openssl x509 -req -in seal.csr -CA root.crt -CAkey root.key -CAcreateserial \
  -sha256 -days 1095 -extfile seal.ext -out seal.crt

# Key, seal certificate and root in one file, with 3DES so every reader can open it.
openssl pkcs12 -export -inkey seal.key -in seal.crt -certfile root.crt \
  -name "Codevibe Sign seal" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -out seal.p12 -passout env:SEAL_PASSPHRASE
shred -u seal.key seal.csr seal.ext
sudo chown 1001:1001 seal.p12 && sudo chmod 400 seal.p12
openssl x509 -in seal.crt -noout -subject -issuer -enddate
openssl x509 -in root.crt -noout -fingerprint -sha256
```

On OpenSSL 1.1, use `-nodes` instead of `-noenc`. The app runs as user 1001, which is why
the file belongs to it.

Then take `root.key` off the server: copy it to your password manager or an offline drive,
and run `shred -u root.key root.srl`. You need it again only to issue the next seal
certificate. Keep `root.crt` and `seal.crt`: they are the public halves. Publish `root.crt`
and its SHA-256 fingerprint so others can trust your seal.

To rotate the seal key later, bring `root.key` back, run the seal certificate, `pkcs12` and
`shred` steps again (same `root.crt`), restart, and remove `root.key` once more.

A single self-signed certificate still works, and installs that already use one need no
change:

```sh
openssl req -x509 -newkey rsa:3072 -sha256 -days 1095 -noenc \
  -keyout seal.key -out seal.crt \
  -subj "/CN=Codevibe Sign/O=Codevibe Technology/C=IN" \
  -addext "keyUsage=critical,digitalSignature,nonRepudiation" \
  -addext "extendedKeyUsage=1.3.6.1.5.5.7.3.36,1.3.6.1.4.1.311.10.3.12"
openssl pkcs12 -export -inkey seal.key -in seal.crt -name "Codevibe Sign seal" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -out seal.p12 -passout env:SEAL_PASSPHRASE
shred -u seal.key
```

Either kind proves the document has not changed since it was sealed. To have PDF readers
also name the sealer as trusted on their own, buy a document-signing certificate from a
certificate authority on the readers' trust lists and put its `.p12` (with its chain) here
instead.

Put a copy of `seal.p12` and `.env` in your password manager or secrets store. Losing the
seal does not break documents already sealed, but new ones would carry a different
certificate.

### Public record pages

Each sealed document's certificate page carries a QR code and a link to
`<APP_URL>/r/<record id>`: a public page with the seal status, the signers and the audit trail,
never the document. Keep `APP_URL` at the address people can reach, because it is printed
inside the sealed files. An admin can turn records off for a workspace in **Settings >
Workspace**; certificates are then printed without a code.

### Timestamps

Set `SEAL_TSA_URL` in `.env`, for example to DigiCert's free authority
`http://timestamp.digicert.com`, and every seal also carries an RFC 3161 timestamp
(PAdES B-T). The signing time is then vouched for by the authority, not only by this server,
which is what validators rely on once the seal certificate has expired. Only a hash of the
seal leaves the server. While the authority is unreachable, sealing fails and is retried;
set `SEAL_TSA_REQUIRED=false` to seal without the timestamp instead (a warning is logged).

Sealed documents are certified (DocMDP, no changes allowed): PDF readers show "Certified by"
and report any later edit.

## 5. First start

Each release is published as a ready-made image for `linux/amd64` and `linux/arm64`:
`ghcr.io/codevibe-technology/codevibe-sign`, tagged with the version (`0.1.1`), its minor line
(`0.1`), `latest` and `sha-<commit>`. Set `SIGN_IMAGE_TAG` in `.env` to the release you run,
then pull it and start:

```sh
cd /opt/codevibe-sign/deploy
docker compose pull web
docker compose up -d
docker compose ps            # web and db become "healthy" within a minute
docker compose logs -f web   # stop with Ctrl-C
```

Each image carries a signed build provenance attestation, so you can check that it was built
by this repository's release workflow from the tagged source before you run it (this needs
the [GitHub CLI](https://cli.github.com/)):

```sh
gh attestation verify oci://ghcr.io/codevibe-technology/codevibe-sign:0.1.1 --owner codevibe-technology
```

### Building from source instead

To run your own changes, or a commit that is not a release, build the image on the server.
The build compiles the libraries, the docs and the app inside Docker; it takes a few minutes
and needs about 3 GB of free memory and disk while it runs. The local build gets the name
`ghcr.io/codevibe-technology/codevibe-sign:<SIGN_IMAGE_TAG>`, so give it a tag no release
uses, such as the commit:

```sh
cd /opt/codevibe-sign/deploy
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose build web
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d
```

An image that is present locally is never pulled, so `up` runs the build. To build on another
machine instead, build and push the image there and set `image:` to it.

## 6. Migrations

With `AUTO_MIGRATE=true` (the default in `.env.example`) the app brings the database up to
date each time it starts, under a lock, so it is safe to leave on. To run them by hand, for
example before an upgrade with `AUTO_MIGRATE=false`:

```sh
docker compose exec web node ops/migrate.mjs
```

It prints the migrations it applied, or "Database is up to date."

## 7. Smoke test

```sh
curl -fsS https://sign.codevibe.in/api/health        # {"ok":true}
curl -fsSI https://sign.codevibe.in/ | head -n 1        # HTTP/2 200
curl -fsSI https://sign.codevibe.in/docs | head -n 1    # HTTP/2 200
curl -fsS https://sign.codevibe.in/robots.txt
```

Then in a browser:

1. Open `https://sign.codevibe.in`, press **Start free**, choose **Email me a link instead**
   and enter your email. The link arrives by email (check `docker compose logs web` if it does
   not) and creates your account.
2. Create a workspace. The dashboard, at `/dashboard`, shows **Start here** with a sample
   agreement. Under **Settings → Personal** set a password, sign out, and sign in with it.
   Under **Settings → Workspace** check the time zone: it is `SIGN_TIME_ZONE` until you save
   another. The address shown there (`/dashboard/<slug>`) can be changed with **Change
   address**; old links redirect to the new one.
3. Open the sample, press **Send**, open the email, sign, and download the sealed copy.
4. On **Verify**, upload the sealed copy: it should say the seal is valid.
5. **Settings → Plan and usage** shows the Free plan with its meters (hosted mode).

## 8. Changing an account's plan

```sh
docker compose exec -e PLAN_CHANGED_BY="ops:$USER" web node ops/plan-set.mjs <workspace-slug or owner-email> cloud
```

The plan is `free`, `cloud` or `unlimited`. Each change is recorded in `app_plan_changes` with
who made it. In a source checkout the same command is
`pnpm --filter web plan:set <workspace-slug or owner-email> <plan>`.
Use the workspace's current address; an old one is not accepted here.

Setting a plan by hand ends any paid term the account has, extra members included, and from
then on billing leaves the plan alone. If the account had paid for time it will not get,
refund it from the Razorpay dashboard.

A plan belongs to an account: the person who created the workspace, and every workspace they
created. The command finds the account from one of its workspaces or from its owner's email
address, moves all of its workspaces together and prints which ones. Upgrading to this
version gives every existing workspace an account (its creator's, or its earliest owner's);
someone who owns several workspaces gets one account holding all of them, on the highest plan
among them. On the hosted Free plan an account includes one workspace: people who already
have more keep them all, and cannot create another until they move to Cloud.

## 9. Backups

Back up the database and the files together, at least daily, and copy them off the server:

```sh
cd /opt/codevibe-sign/deploy
mkdir -p backups
stamp=$(date +%F-%H%M)
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/db-$stamp.dump"
docker run --rm -v codevibe-sign_sign-files:/data:ro -v "$PWD/backups":/backup alpine:3.20 \
  tar czf "/backup/files-$stamp.tgz" -C /data .
ls -lh backups/
```

Run it from cron (for example `15 2 * * *`), keep at least 14 days, and sync `backups/` to
storage on another machine (for example with `rclone` or `rsync`). `.env` and
`secrets/seal.p12` are not in these files; keep them in your secrets store.

## 10. Restore drill

Do this once after the first backup and then every quarter. It restores into a scratch
database and folder next to the live ones, so nothing in use is touched:

```sh
cd /opt/codevibe-sign/deploy
dump=$(ls -t backups/db-*.dump | head -n 1)
files=$(ls -t backups/files-*.tgz | head -n 1)

docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" sign_restore'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d sign_restore --no-owner' < "$dump"
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d sign_restore -c \
  "select (select count(*) from app_workspaces) as workspaces, (select count(*) from sign_envelopes) as envelopes"'

mkdir -p /tmp/sign-restore && tar xzf "$files" -C /tmp/sign-restore
find /tmp/sign-restore -type f | wc -l

docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" sign_restore'
rm -r /tmp/sign-restore
```

The counts should match the live database, and the file count should be close to the live
volume's. To restore for real: stop the app (`docker compose stop web`), drop and recreate
the database, `pg_restore` the dump into it, empty the files volume and extract the archive
into it, then `docker compose up -d`.

## 11. Upgrades

With the published image, update the checkout for any change to `compose.yml` or
`.env.example`, set `SIGN_IMAGE_TAG` in `.env` to the new release, then pull and restart:

```sh
cd /opt/codevibe-sign
git fetch --tags && git checkout v<version>
cd deploy
# take a backup first (step 9), then set SIGN_IMAGE_TAG=<version> in .env
docker compose pull web
docker compose up -d web
docker compose logs -f web    # migrations run on start
```

Building from source instead:

```sh
cd /opt/codevibe-sign
git fetch --tags && git checkout <release-tag>     # or: git pull
cd deploy
# take a backup first (step 9)
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose build web
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d web
docker compose logs -f web    # migrations run on start
```

Then repeat the smoke test. When you build from source, set `SIGN_IMAGE_TAG` in `.env` to the
new tag so later `docker compose` commands use it. Migrations only move forward: to roll back,
run (or build) the previous release and restore the backup taken before the upgrade.

### Rolling back past the release that introduced accounts

That release gives every workspace an account (`app_workspaces.account_id`, which may not be
empty). An older build does not fill the column, so if you run an older build on the upgraded
database without restoring the backup, existing workspaces keep working but nobody can create
a new one. Either restore the backup, or drop the rule first:

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "alter table app_workspaces alter column account_id drop not null"'
```

Workspaces created by the older build then have no account. Before upgrading again, restore
the backup or ask for help: the newer build expects every workspace to have one.

A database that ran a build made from the development branch before accounts existed
(migrations named `0013_billing` or `0014_plan_v2` in `app_migrations`) cannot be upgraded in
place; the app stops at start-up and says so. Restore the backup taken before that build.

## 12. Payments, invoices and Aadhaar eSign

Everything here is optional. Without these settings the app runs as before and shows
"coming soon" where something would be sold. Start with test keys, try it, then switch to
live keys.

### Setting a value without showing it

`set-secret.sh` writes one variable to `.env`. It asks for the value with the input hidden,
so the value is not on screen, in the shell history or in the process list. The old file is
kept as `.env.bak-<time>`. `restart.sh` starts the app again with the new `.env`; nothing is
built, and it takes under a minute.

```sh
cd /opt/codevibe-sign/src/deploy     # the folder with compose.yml
./set-secret.sh RAZORPAY_KEY_SECRET  # type or paste the value, press Enter
./restart.sh
```

`./set-secret.sh --unset NAME` removes a variable. An upgrade (step 11) also picks up `.env`.

### Settings

| Variable                                                                 | Default                            | What it is                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`                                 | none                               | Razorpay API keys, set together. `rzp_test_` keys are test mode.                                                                                                                                                                   |
| `RAZORPAY_WEBHOOK_SECRET`                                                | none                               | The secret of the Razorpay webhook (below).                                                                                                                                                                                        |
| `BILLING_LIVE`                                                           | `false`                            | `true` once real money is taken. Test keys and the eSign sandbox are then refused.                                                                                                                                                 |
| `INVOICE_SELLER_NAME`, `INVOICE_SELLER_GSTIN`, `INVOICE_SELLER_ADDRESS`  | none                               | Who issues the invoices, set together. The state comes from the GSTIN.                                                                                                                                                             |
| `INVOICE_SELLER_CIN`, `INVOICE_SELLER_PAN`                               | none, from GSTIN                   | Printed in the invoice header.                                                                                                                                                                                                     |
| `INVOICE_SELLER_PHONE`, `INVOICE_SELLER_EMAIL`, `INVOICE_SELLER_WEBSITE` | none                               | Contact lines in the invoice header. Each is left out when unset.                                                                                                                                                                  |
| `INVOICE_UPI_ID`                                                         | none                               | Printed as a "Pay using UPI" QR code.                                                                                                                                                                                              |
| `INVOICE_BANK_NAME`, `_HOLDER`, `_ACCOUNT`, `_IFSC`                      | none                               | Bank details on the invoice, set together. `INVOICE_BANK_BRANCH` is optional.                                                                                                                                                      |
| `INVOICE_LOGO_PATH`, `INVOICE_SIGNATURE_PATH`                            | none                               | PNG or JPEG files inside the container, up to 1 MB (see "Logo and signature").                                                                                                                                                     |
| `INVOICE_SERIES`                                                         | `CV-{FY}`                          | Invoice numbers. `{FY}` is the financial year as six digits: `CV-2026270001`. At most 16 characters.                                                                                                                               |
| `CREDIT_NOTE_SERIES`, `PROFORMA_SERIES`                                  | `CVCN-{FY}`, `CVPI-{FY}`           | Kept for credit notes and proforma invoices, so their numbers never collide.                                                                                                                                                       |
| `INVOICE_SAC`                                                            | `997331`                           | The SAC code printed on invoices: licensing services for the right to use computer software.                                                                                                                                       |
| `GST_PERCENT`                                                            | `18`                               | GST added on top of every price.                                                                                                                                                                                                   |
| `LEEGALITY_API_KEY`, `LEEGALITY_PRIVATE_SALT`, `LEEGALITY_WORKFLOW_ID`   | none                               | The operator's Leegality account, set together: the Auth Token, the Private Salt and the Workflow ID.                                                                                                                              |
| `LEEGALITY_BASE_URL`                                                     | the sandbox                        | `https://sandbox.leegality.com/api` or `https://app1.leegality.com/api`.                                                                                                                                                           |
| `LEEGALITY_POSITION_API`                                                 | `v2.1`, or `v4` with a V4 workflow | Which Leegality API places the Aadhaar seal position a sender puts on the page: `v2.1` (the 2.1 Create API with the same Auth Token; no Leegality setup), `v4` or `off` (the box is kept, the v3.0 workflow places the signature). |
| `LEEGALITY_V4_PAYLOAD_FILE`, `LEEGALITY_V4_WORKFLOW_ID`                  | none                               | Only for accounts with V4 workflows: the path of the file a V4 workflow's Download API Payload gives, or its full ID, for `LEEGALITY_POSITION_API=v4`.                                                                             |
| `LEEGALITY_COORDINATE_UNITS`, `LEEGALITY_COORDINATE_ORIGIN`              | `points`, `bottom-left`            | How the box becomes Leegality coordinates: `points` or `pixels@<dpi>`, and `bottom-left` or `top-left`. Leegality does not document them; confirm with one sandbox eSign (the Aadhaar eSign guide, "Calibrate the coordinates").   |
| `ESIGN_PROVIDER_COST_INR`                                                | none                               | What one Aadhaar eSign costs you. Until it is set, nothing can be bought.                                                                                                                                                          |
| `ESIGN_MARKUP_INR`                                                       | `10`                               | Added to the cost on the Free plan. Customers only see the resulting price per eSign.                                                                                                                                              |
| `CREDIT_PACKS`                                                           | `10,50,200`                        | The credit packs offered.                                                                                                                                                                                                          |
| `ESIGN_SESSION_HOURS`                                                    | `24`                               | How long a started eSign is waited for and its credit held. Set it at least as long as your Leegality workflow keeps an invitation open, so a credit is never returned while the request can still be signed.                      |
| `ESIGN_ACCEPT_UNREADABLE_SIGNATURES`                                     | `false`                            | By default a provider file whose signature the server cannot check fails the eSign. `true` accepts it and notes that on the record. Only for a provider signature format the server cannot read.                                   |
| `CLOUD_PRICE_INR`, `CLOUD_INCLUDED_MEMBERS`, `CLOUD_EXTRA_MEMBER_INR`    | `999`, `25`, `99`                  | The Cloud plan per month, the members it includes and the price of each extra member.                                                                                                                                              |
| `CLOUD_ANNUAL_MONTHS`, `CLOUD_GRACE_DAYS`                                | `10`, `7`                          | Months charged for a year, and days after a missed renewal before Free limits apply.                                                                                                                                               |
| `INSTALL_HELP_PRICE_INR`                                                 | `1999`                             | The installation help service.                                                                                                                                                                                                     |
| `ORDER_PAYMENT_WINDOW_MINUTES`                                           | `30`                               | How long after an order is opened a payment for it is still honoured (5 to 1440).                                                                                                                                                  |
| `OPERATOR_EMAIL`                                                         | none                               | Where notifications for the operator go.                                                                                                                                                                                           |
| `HOSTING_OFFERS`                                                         | empty                              | JSON list of `{ "name", "url", "note" }` shown under "Need a server?". Hidden while empty.                                                                                                                                         |
| `SECRETS_KEY`                                                            | from `AUTH_SECRET`                 | Encrypts provider credentials that workspaces save. 32 characters or more.                                                                                                                                                         |

Amounts are in rupees before GST. A value that is set but malformed is reported by name in
the logs and in the health check; the app keeps running.

Changing `SECRETS_KEY`, or `AUTH_SECRET` while `SECRETS_KEY` is unset, makes the Leegality
credentials that workspaces saved unreadable. They then have to be entered again.

### Webhooks to register

- **Razorpay**, Dashboard, Settings, Webhooks: URL `https://<SIGN_HOST>/api/billing/razorpay/webhook`,
  events `payment.captured`, `order.paid`, `refund.created`, `refund.processed`,
  `payment.dispute.created` and `payment.dispute.lost`, and a secret of your choice, which also
  goes in `RAZORPAY_WEBHOOK_SECRET`. Test mode and live mode each have their own webhook list.
- **Leegality**, in the workflow named by `LEEGALITY_WORKFLOW_ID`: Webhook and Error Webhook
  `https://<SIGN_HOST>/api/v1/esign/webhooks/leegality` (version 2.5), and Redirect URL
  `https://<SIGN_HOST>/sign?esign=return`. A request with an Aadhaar seal position needs nothing more: it sets the same
  webhook URL itself (version 2.5 through the 2.1 API, 4.0 through v4) and the redirect URL.

### Test first, then live

1. Add the test keys. Each command asks for one value:

   ```sh
   cd /opt/codevibe-sign/src/deploy
   ./set-secret.sh RAZORPAY_KEY_ID          # rzp_test_...
   ./set-secret.sh RAZORPAY_KEY_SECRET
   ./set-secret.sh RAZORPAY_WEBHOOK_SECRET
   ./set-secret.sh LEEGALITY_API_KEY        # from the Leegality sandbox
   ./set-secret.sh LEEGALITY_PRIVATE_SALT
   ./set-secret.sh LEEGALITY_WORKFLOW_ID
   ./set-secret.sh ESIGN_PROVIDER_COST_INR  # for example 25
   ```

   The seller and bank details are not secret; put them in `.env` with an editor, or with the
   same command.

2. Restart: `./restart.sh`

3. Check the mode:

   ```sh
   curl -s https://<SIGN_HOST>/api/health
   # {"ok":true,"billing":{"razorpay":"test","leegality":"sandbox","live":false,"problems":[]}}
   ```

   The app shows "Test mode" wherever something can be paid for. Payments made with test keys
   get documents numbered `T-2026-0001` that say they are not tax documents, so the tax
   invoice series has no gaps and holds no test invoices.

4. Go live: replace the values and declare the install live.

   ```sh
   ./set-secret.sh RAZORPAY_KEY_ID          # rzp_live_...
   ./set-secret.sh RAZORPAY_KEY_SECRET
   ./set-secret.sh RAZORPAY_WEBHOOK_SECRET  # the secret of the live webhook
   ./set-secret.sh LEEGALITY_API_KEY        # from the production account
   ./set-secret.sh LEEGALITY_PRIVATE_SALT
   ./set-secret.sh LEEGALITY_WORKFLOW_ID
   ./set-secret.sh LEEGALITY_BASE_URL       # https://app1.leegality.com/api
   ./set-secret.sh BILLING_LIVE             # true
   ./restart.sh
   curl -s https://<SIGN_HOST>/api/health
   # {"ok":true,"billing":{"razorpay":"live","leegality":"production","live":true,"problems":[]}}
   ```

   With `BILLING_LIVE=true` a test key or the sandbox URL left behind is refused: that part
   stays switched off and `problems` holds a code (`test_payment_key_while_live`,
   `sandbox_esign_while_live`, or `settings_invalid` for a value that cannot be read). The
   health answer is public, so it never names a setting; the server log does, once at start:

   ```sh
   docker compose logs web | grep '\[billing\]'
   ```

   Without `BILLING_LIVE`, test payment keys together with the production Leegality URL are
   refused for buying eSign credits, so a test payment can never buy a real eSign. Once
   `BILLING_LIVE=true`, an order opened with test keys delivers nothing even if a test payment
   for it arrives, and eSign credits bought with test payments that are still unused are
   removed from every workspace within a minute (they show as "Removed" in the credit
   history).

### Payments that are not applied, refunds and disputes

All of these send an email to `OPERATOR_EMAIL` (set it before taking payments) and leave a row
in `app_audit_log`.

- **A payment that delivers nothing.** A payment is honoured for
  `ORDER_PAYMENT_WINDOW_MINUTES` after its order was opened, counted to the moment the payer
  paid, not to when the news reached the server. A later payment, a payment for extra members
  priced for a term that has since ended or been renewed, a second payment for the same first
  term, and a payment for an account whose plan you have since set by hand are all kept as
  `paid_unapplied`: nothing is added, no invoice is issued and the buyer is told a refund is
  coming. **Refund it from the Razorpay dashboard** (Payments, the payment id in the email,
  Refund), or apply it by hand.
- **A refund.** When Razorpay reports a refund processed for the full amount, the order
  becomes `refunded` and what it bought is taken back as far as it is unused: eSign credits not
  yet spent or held (the email says how many were already used), extra members for the term
  they were bought for, a renewal (the workspace goes back to the term before it) or a first
  term (the workspace moves to Free; nothing is deleted). A partial refund, or one only
  started, changes nothing and tells you. No credit note is issued; `CREDIT_NOTE_SERIES` is
  reserved for that. Raise one with your accountant for a refunded tax invoice.
- **A dispute.** A new dispute only tells you. A lost dispute is treated like a full refund.
- **A plan set by hand.** `plan-set.mjs` marks the plan as yours. Billing then does not sell,
  renew, lower or end it, even if the workspace still has a paid term; set the workspace back
  to `free` to let it buy a plan again.

### Invoices

Every payment produces a GST invoice as a PDF, emailed to the buyer's billing address and
kept on the Billing page. Buyers in the seller's state are charged CGST and SGST, everyone
else IGST. Numbers run without gaps per financial year (1 April to 31 March, Indian time).
When the install has a seal certificate (step 4) the invoice file is signed with it and says
"This is a digitally signed document"; otherwise it says it is computer generated.

#### Logo and signature

The images live in the files volume, so they survive upgrades:

```sh
docker compose exec web mkdir -p /data/branding
docker compose cp ./logo.png web:/data/branding/logo.png
docker compose cp ./signature.png web:/data/branding/signature.png
./set-secret.sh INVOICE_LOGO_PATH        # /data/branding/logo.png
./set-secret.sh INVOICE_SIGNATURE_PATH   # /data/branding/signature.png
./restart.sh
```

### A workspace's own Leegality account

On the Cloud plan, and on any self-hosted install, the account owner can enter the account's own
Leegality account under **Settings, Aadhaar eSign** instead of using yours. They set the same
two URLs in their own Leegality workflow (the page shows them), and Leegality bills them
directly. Nothing in `.env` is needed for this except `SECRETS_KEY`, which encrypts what they
enter. Their credentials cannot be read back from the app, by them or by you.

### Open questions to settle before going live

- **Credits expiry.** Credits do not expire today, and the docs say so as the current policy.
  If they should expire, decide the period before the first live sale.
- **Credits bought on Cloud, spent on Free.** The price of a credit follows the plan at the
  time of purchase, and credits stay in the account's wallet when the plan changes. An account
  can therefore buy a pack while on Cloud and use it after going back to Free. Decide whether
  that is acceptable, or whether credits should carry the plan they were bought on.
- **SAC code.** `INVOICE_SAC` defaults to `997331` (licensing services for the right to use
  computer software), taxed at 18%. Set another code only if your accountant asks for one.

### Self-hosted installs

- The seller on every invoice is whoever the `INVOICE_SELLER_*` variables name. Nothing is
  built in, so an install never issues invoices in another company's name.
- Without Razorpay keys nothing is sold. Aadhaar eSign then works for workspaces that enter
  their own Leegality account under Settings, Aadhaar eSign, billed by Leegality.
- With `PLAN_MODE=self-hosted` and your own `LEEGALITY_*` values in `.env`, every workspace
  signs through your account and no credits are involved.
- With `PLAN_MODE=self-hosted` there are no plan limits and no billing screens.

### Bot protection (optional)

Cloudflare Turnstile can check that a person, not a script, is behind the public forms: sign-in
(password and emailed link), "forgot password", the password step of an invitation and the
installation help booking. It is off until both keys are set, so installs without it work as
before. Signing links are not checked: they already carry their own secret.

1. In the Cloudflare dashboard, open **Turnstile > Add widget**. Name it, add the host name the
   app is served on (`SIGN_HOST`, for example `sign.codevibe.in`), and pick the **Managed**
   widget mode.
2. Set both keys and start the app again:

   ```sh
   ./set-secret.sh TURNSTILE_SITE_KEY
   ./set-secret.sh TURNSTILE_SECRET_KEY
   ./restart.sh
   ```

3. Open `/sign-in` in a private window and sign in. Most people never see the check; when
   Cloudflare is unsure it shows a box to tick above the button.

The server asks Cloudflare about each token and refuses the request when the answer is not a
clear yes, including when Cloudflare cannot be reached. The person then sees what to do and can
try again. If sign-in breaks after setting the keys, check that the host name in the widget
matches `SIGN_HOST`, or clear both keys and run `./restart.sh` to turn the check off.

## Troubleshooting

| What you see                                     | What to check                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `Invalid configuration: ...` in the logs         | The variable named in the message; fix it in `.env` and `docker compose up -d`.                              |
| `SEAL_P12_PATH is not set` or a seal error       | `secrets/seal.p12` exists, belongs to 1001, and `SEAL_PASSPHRASE` matches it.                                |
| Browser shows Traefik's default certificate      | DNS (step 2), `TRAEFIK_CERTRESOLVER`, and the Traefik logs for the ACME error.                               |
| `404 page not found` from Traefik                | `TRAEFIK_NETWORK` is the network Traefik watches, and `web` is healthy (`docker compose ps`).                |
| `billing.problems` in `/api/health` is not empty | `docker compose logs web \| grep '\[billing\]'` names the variable (step 12); fix it and run `./restart.sh`. |
| No sign-in emails                                | `MAIL_TRANSPORT` and `MAIL_FROM`; the logs show the SMTP or Microsoft Graph error.                           |
| "The security check …" on every sign-in          | The Turnstile widget's host name matches `SIGN_HOST`, and both `TURNSTILE_*` keys are from the same widget.  |
