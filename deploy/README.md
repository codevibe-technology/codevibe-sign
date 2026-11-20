# Deploying Codevibe Sign

This folder runs the web app (the app, the HTTP API and the docs at `/docs`) and PostgreSQL
with Docker Compose, behind a Traefik that already runs on the server and owns ports 80 and 443. The same files serve the Codevibe cloud at `sign.codevibe.in` (`PLAN_MODE=hosted`) and
a self-hosted install (`PLAN_MODE=self-hosted`).

| File           | What it is                                                                  |
| -------------- | --------------------------------------------------------------------------- |
| `compose.yml`  | The `web` service (built from `apps/web/Dockerfile`) and `db` (PostgreSQL). |
| `.env.example` | Every setting, with notes. Copy it to `.env`.                               |
| `secrets/`     | `seal.p12`, the certificate that seals signed PDFs. Never committed.        |

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
  for its domain.

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

## 4. Seal certificate

Every completed document is sealed with this certificate. Create it on the server, so the
private key never travels:

```sh
cd /opt/codevibe-sign/deploy
mkdir -p secrets && chmod 700 secrets && cd secrets
export SEAL_PASSPHRASE="$(grep '^SEAL_PASSPHRASE=' ../.env | cut -d= -f2-)"
openssl req -x509 -newkey rsa:3072 -sha256 -days 1095 -noenc \
  -keyout seal.key -out seal.crt \
  -subj "/CN=Codevibe Sign/O=Codevibe Technology/C=IN"
openssl pkcs12 -export -inkey seal.key -in seal.crt -name "Codevibe Sign seal" \
  -out seal.p12 -passout env:SEAL_PASSPHRASE
shred -u seal.key
sudo chown 1001:1001 seal.p12 && sudo chmod 400 seal.p12
openssl x509 -in seal.crt -noout -subject -enddate
```

On OpenSSL 1.1, use `-nodes` instead of `-noenc`. The app runs as user 1001, which is why
the file belongs to it. Keep `seal.crt`: it is the public half, and you can publish it so
others can check your seal. A self-signed seal proves the document has not changed since it
was sealed; to have PDF readers also show the signer as trusted, buy a document-signing
certificate from a certificate authority on the Adobe trust list and put its `.p12` here
instead.

Put a copy of `seal.p12` and `.env` in your password manager or secrets store. Losing the
seal does not break documents already sealed, but new ones would carry a different
certificate.

## 5. First start

```sh
cd /opt/codevibe-sign/deploy
docker compose build web
docker compose up -d
docker compose ps            # web and db become "healthy" within a minute
docker compose logs -f web   # stop with Ctrl-C
```

The build compiles the libraries, the docs and the app inside Docker; it takes a few
minutes and needs about 3 GB of free memory and disk while it runs. To build on another
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

1. Open `https://sign.codevibe.in`, press **Start free** and sign in with your email. The
   link arrives by email (check `docker compose logs web` if it does not).
2. Create a workspace. The dashboard shows **Start here** with a sample agreement.
3. Open the sample, press **Send**, open the email, sign, and download the sealed copy.
4. On **Verify**, upload the sealed copy: it should say the seal is valid.
5. **Settings → Plan and usage** shows the Free plan with its meters (hosted mode).

## 8. Changing a workspace's plan

```sh
docker compose exec -e PLAN_CHANGED_BY="ops:$USER" web node ops/plan-set.mjs <workspace-slug> cloud
```

The plan is `free`, `cloud` or `unlimited`. Each change is recorded in `app_plan_changes` with
who made it. In a source checkout the same command is
`pnpm --filter web plan:set <workspace-slug> <plan>`.

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

```sh
cd /opt/codevibe-sign
git fetch --tags && git checkout <release-tag>     # or: git pull
cd deploy
# take a backup first (step 9)
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose build web
SIGN_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d web
docker compose logs -f web    # migrations run on start
```

Then repeat the smoke test. Set `SIGN_IMAGE_TAG` in `.env` to the new tag so later
`docker compose` commands use it. Migrations only move forward: to roll back, check out the
previous release, build it, and restore the backup taken before the upgrade.

## Troubleshooting

| What you see                                | What to check                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Invalid configuration: ...` in the logs    | The variable named in the message; fix it in `.env` and `docker compose up -d`.               |
| `SEAL_P12_PATH is not set` or a seal error  | `secrets/seal.p12` exists, belongs to 1001, and `SEAL_PASSPHRASE` matches it.                 |
| Browser shows Traefik's default certificate | DNS (step 2), `TRAEFIK_CERTRESOLVER`, and the Traefik logs for the ACME error.                |
| `404 page not found` from Traefik           | `TRAEFIK_NETWORK` is the network Traefik watches, and `web` is healthy (`docker compose ps`). |
| No sign-in emails                           | `MAIL_TRANSPORT` and `MAIL_FROM`; the logs show the SMTP error.                               |
