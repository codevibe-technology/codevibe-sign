# Codevibe Sign web app

The product people use: sign in, create a workspace, invite the team, set the brand, create
API keys, and (in the next releases) send documents and follow their progress. It runs the
sign API inside the same Next.js server, so one deploy serves the app at `/` and the HTTP API
at `/api/v1`.

How it is built, and the rules for changing it, are in
[docs/APP-ARCHITECTURE.md](../../docs/APP-ARCHITECTURE.md).

## Run it locally

You need Node 20+, pnpm and a PostgreSQL 16 database.

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

## Scripts

| Script       | What it does                                                                           |
| ------------ | -------------------------------------------------------------------------------------- |
| `dev`        | Next.js in development mode.                                                           |
| `build`      | Production build.                                                                      |
| `start`      | Serves the production build.                                                           |
| `db:migrate` | Migrates `DATABASE_URL`: the sign server's tables, then the app's.                     |
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
