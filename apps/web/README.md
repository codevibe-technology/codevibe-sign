# Codevibe Sign web app

The product people use: sign in, create a workspace, invite the team, set the brand, create
API keys, send documents for signature, follow their progress and verify signed copies. The
people who sign need no account: their link opens a signing page in the sender's brand. It runs the
sign API inside the same Next.js server, so one deploy serves the app at `/` and the HTTP API
at `/api/v1`.

How it is built, and the rules for changing it, are in
[docs/APP-ARCHITECTURE.md](../../docs/APP-ARCHITECTURE.md).

## Run it locally

You need Node 22.18+, pnpm and a PostgreSQL 16 database.

```sh
pnpm install
pnpm build                                        # the packages the app uses
docker compose -f apps/web/docker-compose.dev.yml up -d   # or bring your own PostgreSQL
cp apps/web/.env.example apps/web/.env.local      # then set AUTH_SECRET
pnpm --filter web dev:seal                        # development seal certificate
pnpm --filter web db:migrate                      # or keep AUTO_MIGRATE=true
pnpm --filter web dev
```

Open http://localhost:3000 and sign in with any email address. With `MAIL_TRANSPORT=console`
the sign-in link is printed in the terminal running `dev`.

## Sending a document

**Send a document** walks through four steps: upload the PDFs, add who signs, approves or gets a
copy (and in which order), drag the signature boxes onto the pages, then review and send. The
draft is saved once there are recipients and after every change, so it can be closed and picked
up later from the envelopes list. Each envelope page shows the timeline, the recipients'
progress, the certificate and whether the seal on the signed copy checks out; **Verify** checks
any PDF someone sends back against this workspace's seal.

## Templates and bulk send

**Templates** keeps documents you send again and again. Upload the PDFs once, name the roles
(Employee, HR manager), place their fields and save. **Use** fills each role with a person and
sends; **Bulk send** takes a CSV with one row per envelope (up to 500), shows every row with
its problems pointing at the column, and sends in the background while a progress page follows
it. Download the sample CSV from the bulk page to start.

## Webhooks

**Settings → Webhooks** sends signed events to your own systems as envelopes are sent,
signed, completed or declined. Pick the events, copy the secret (shown once), send a test
event, and follow every delivery with its payload; failed ones can be sent again.
To try webhooks without a server of your own, add `${APP_URL}/api/webhooks/test` as the
endpoint: it accepts every delivery and stores nothing, so the delivery log shows each one
as delivered.

## Signing a document

The link in the email opens `/sign`, headed with the sender's logo, colour and name. The
signer confirms a one-time code if the sender asked for one, agrees to sign electronically,
fills the highlighted fields ("Next field" walks through them) and finishes, or declines with
a reason. The thank-you page offers **Download your copy** as soon as everyone has signed and
the copy is sealed. Links that are used, expired or withdrawn get a page that says why and what
to do next. In development, open the link printed in the `dev` terminal.

## Brand

**Settings → Brand** sets the logo, colour and font; the sender name and reply-to of the
emails; the subject and opening text of the invitation, reminder, completed and cancelled
emails (with variables such as `{{recipient_name}}` and a live preview); the "Secured by
Codevibe Sign" badge; a footer line for the signing certificate; and a custom domain for
signing links. The domain is stored and its DNS record shown; serving it is deployment work,
described in [docs/APP-ARCHITECTURE.md](../../docs/APP-ARCHITECTURE.md#custom-signing-domains).

## Plans and limits

`PLAN_MODE=self-hosted` (the default) puts no limits on any workspace and shows no plan
screens. `PLAN_MODE=hosted` is the Codevibe cloud: new workspaces start on the Free plan, and
Settings → Plan and usage shows each limit with its meter. The limits are in
[src/lib/plans.ts](src/lib/plans.ts); `FREE_PLAN_LIMITS` overrides the Free ones with JSON. A
send, upload or invitation past a limit is refused with a message that names the limit, the
usage and what to do; the API answers `403` with code `PLAN_LIMIT`. Hosted mode also serves
the public home page at `/`, `/terms` and `/privacy`, and gives each new Free workspace a
sample agreement to send to yourself.

Move a workspace to another plan with `pnpm --filter web plan:set <workspace-slug> <free|cloud|unlimited>`
(in the Docker image: `node ops/plan-set.mjs`). Every change is recorded in `app_plan_changes`.

## Docs

`pnpm --filter web build:docs` builds the docs site (`apps/site`) and copies it to
`docs-dist`, which the app serves at `/docs`.

## Deploying

[deploy/README.md](../../deploy/README.md) runs the app and PostgreSQL with Docker Compose behind
Traefik, from [Dockerfile](Dockerfile).

## Scripts

| Script       | What it does                                                                           |
| ------------ | -------------------------------------------------------------------------------------- |
| `dev`        | Next.js in development mode.                                                           |
| `build`      | Production build.                                                                      |
| `start`      | Serves the production build.                                                           |
| `db:migrate` | Migrates `DATABASE_URL`: the sign server's tables, then the app's.                     |
| `plan:set`   | Moves a workspace to another plan and records the change.                              |
| `build:docs` | Builds the docs site and copies it into `docs-dist` for `/docs`.                       |
| `build:ops`  | Bundles `migrate` and `plan:set` into `ops/` for the Docker image.                     |
| `sample:pdf` | Regenerates the first-run sample agreement PDF.                                        |
| `dev:seal`   | Writes a self-signed seal certificate to `data/dev-seal.p12`.                          |
| `test`       | Unit and component tests. With `DATABASE_URL` set, also the PostgreSQL suite.          |
| `smoke`      | Starts the built app against `DATABASE_URL` and walks sign-in, the guards and the API. |

## Configuration

Every variable is described in [.env.example](.env.example). A missing or malformed one stops
the request with a message that names it.

## Using the API

Create a key under **Settings → API keys** and call `${APP_URL}/api/v1` with
`Authorization: Bearer <key>`. The API is the sign server's; see
[packages/server](../../packages/server/README.md). Each key acts in its own workspace only.

## Licence

AGPL-3.0-only © Codevibe. See [LICENSING.md](../../LICENSING.md).
