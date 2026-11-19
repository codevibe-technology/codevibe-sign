# Web app architecture

`apps/web` is the Codevibe Sign product: the screens people use to send documents, watch
their progress, manage templates and run a workspace. It sits on top of the packages in this
repository and adds accounts, workspaces, roles and branding. The same build runs on a single
self-hosted machine today and is the base of the Codevibe-hosted cloud.

This document says how it is put together and which rules every later change must keep. The
packages' own design is in [ARCHITECTURE.md](ARCHITECTURE.md); the security rules are in
[THREAT-MODEL.md](THREAT-MODEL.md) and [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md).

## At a glance

```
 browser ──────────────┐
   app pages (RSC)     │      ┌──────────────── apps/web (one Node process) ────────────────┐
   server actions      ├────▶ │ Next.js App Router                                           │
   /api/auth/*         │      │   ├─ pages, layouts, server actions  (app data, guards)      │
   /api/v1/*  ─────────┤      │   ├─ /api/auth/*   Better Auth (magic link, Google)           │
   /api/sign/:token    │      │   └─ /api/v1/*, /api/sign/*  ──▶ createSignServer().app (Hono)│
 sender's backend ─────┘      │                                   │                          │
   Bearer cvs_… key           │                principal = { workspaceId, id, readOnly }     │
                              └──────────────┬────────────────────┴─────────────┬────────────┘
                                             │  one `postgres` driver           │
                                         PostgreSQL                         file store
                               auth_*, app_*  +  sign_* tables        PDFs, sealed files, logos
```

- **One deploy serves the app and the API.** The sign server is a Hono app; the web app
  mounts it inside Next.js route handlers, so `https://<host>/api/v1/envelopes` is the same
  HTTP API the standalone server offers, and nothing else has to be run or kept in step.
- **The standalone server still works** (`apps/server`, `startSignServer`). For scale, the API
  can run as its own processes against the same database: they are given the same
  `authenticate` and `webhookTargets` functions the app uses (they only read SQL), and the
  load balancer sends `/api/v1/*` and `/api/sign/*` to them.

## Versions

| What             | Version (pinned exactly)                      | Licence   |
| ---------------- | --------------------------------------------- | --------- |
| Next.js          | 16.4.5 (App Router, Turbopack)                | MIT       |
| React, React DOM | 19.3.1 (same as the rest of the repo)         | MIT       |
| Better Auth      | 1.7.18                                        | MIT       |
| Kysely           | 0.29.8, with `kysely-postgres-js` 5.0.1       | MIT       |
| `postgres`       | 3.4.9 (the driver `sign-server` already uses) | Unlicense |
| Tailwind CSS     | 4.3.4 (`@tailwindcss/postcss`)                | MIT       |
| Radix primitives | `radix-ui` 1.8.1                              | MIT       |
| Toasts           | `sonner` 2.0.8                                | MIT       |
| Icons            | `lucide-react` 1.69.0                         | ISC       |

Every version is the newest stable release that was at least two weeks old when it was chosen.
Dependency updates follow the same rule.

## Mounting the sign server

`src/server/sign/server.ts` builds one `SignServer` per process with
`createSignServer({ basePath: '/api', authenticate, webhookTargets, ... })` and keeps it on
`globalThis`, so development reloads do not open a new pool each time.

- `src/app/api/v1/[...path]/route.ts` and `src/app/api/sign/[token]/route.ts` hand the
  incoming `Request` to `sign.app.fetch` unchanged. Because the server knows its `basePath`,
  its cookie paths (`/api/v1/sign`) and cache headers match the public URLs.
- Signing links are `${APP_URL}/api/sign/<token>`. That route swaps the token for an HttpOnly
  cookie and redirects to `${APP_URL}/sign`, the signing page (a Next page).
- `tick()` runs from `src/instrumentation.ts` on a timer in the Node runtime, once per
  process; reminders, expiry and job retries are safe to run from several processes.
- Server code calls the API in-process through `signRequest(principal, path, init)`
  (`src/server/sign/client.ts`): it builds a `Request`, registers the principal for that exact
  object in a `WeakMap`, and calls `sign.app.fetch`. Nothing on the wire can forge it.

## Multi-tenancy

A **workspace** owns everything: envelopes, documents, audit events, templates, API keys,
webhooks, brand settings, members and invitations. Every app table that holds workspace data
has a `workspace_id` column and every query filters on it. There is no query that reads
workspace data by id alone.

### Server change (backwards compatible)

`@codevibe_technology/sign-server` learns about workspaces without breaking existing users:

| Change                                                                                                            | Existing single-tenant use                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `sign_envelopes.workspace_id text not null default 'default'` (migration `0003_workspaces`) with an index.        | Old rows land in `default`.                                                    |
| `ApiKey` takes an optional `workspaceId`; without one a key belongs to `DEFAULT_WORKSPACE` (`'default'`).         | Every configured key keeps working and sees every envelope it saw before.      |
| `authenticate(request)` option: returns a `Principal` (`{ id, workspaceId, readOnly? }`) or `null` to fall back.  | Not set: only configured keys are checked, as today.                           |
| `webhookTargets(workspaceId)` option: the targets for a workspace, read at enqueue and at delivery time.          | Static `webhooks` keep firing, for envelopes in the default workspace.         |
| `ServerStore.commit(..., { workspaceId })` on create; `load()` returns `workspaceId`; `list(workspaceId, query)`. | A custom store that ignores the new argument holds only the default workspace. |
| `GET /v1/envelopes` lists the caller's envelopes (newest first, cursor, status filter).                           | New route; nothing else changes.                                               |
| `basePath` option for mounting under a prefix such as `/api`.                                                     | Default `''`.                                                                  |

Rules the server enforces:

- Every sender route resolves the principal first and loads envelopes with
  `load(id)` plus a workspace comparison. An envelope in another workspace answers
  `ENVELOPE_NOT_FOUND`, exactly like one that does not exist, so ids cannot be probed.
- Files are only reachable through an envelope route (sender, after the workspace check) or a
  signing token (which names one envelope). File keys are never taken from the request.
- Webhook jobs carry the envelope's `workspaceId`; the delivery looks the target and its
  secret up again for that workspace, so a removed or rotated webhook stops at once and secrets
  never sit in the job table.
- Idempotency keys and rate limits are scoped by workspace and principal.
- A `readOnly` principal (the viewer role) may only use `GET` routes.

### Self-hosted, cloud

- **Cloud**: anyone may sign up and create workspaces; a person can belong to many and switch
  between them.
- **Self-hosted, one workspace** (`SINGLE_WORKSPACE=true`): the first person to sign in creates
  the workspace; after that nobody can create another, and new people join by invitation only.
  Nothing else differs, so a self-hosted install can later move to the cloud by copying rows.

## Accounts and sessions

Better Auth runs at `/api/auth/*` with:

- **Email magic link** (plugin `magicLink`): links expire after 10 minutes and work once. In
  development (`MAIL_TRANSPORT=console`) the link is printed to the server console.
- **Google** when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; the button is hidden
  otherwise.
- Database sessions in an HttpOnly, `SameSite=Lax`, `Secure` (on https) cookie, 30 days,
  refreshed daily. Telemetry is off.

Better Auth talks to PostgreSQL through Kysely with the `kysely-postgres-js` dialect, so the
whole app has one driver and one pool. Its tables are created by our own SQL migration
(`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, snake_case columns
mapped in the Better Auth config), not by its CLI.

### Roles

Each membership has one role. Higher roles include everything below them.

| Permission                                           | viewer | member | admin | owner |
| ---------------------------------------------------- | :----: | :----: | :---: | :---: |
| See envelopes, templates, the dashboard              |   ✓    |   ✓    |   ✓   |   ✓   |
| Create, send, void envelopes; use and edit templates |        |   ✓    |   ✓   |   ✓   |
| Workspace name, brand, API keys, webhooks            |        |        |   ✓   |   ✓   |
| Invite and remove members, admins and viewers        |        |        |   ✓   |   ✓   |
| Make or remove owners, delete the workspace          |        |        |       |   ✓   |

A workspace always keeps at least one owner. Permissions live in one table in
`src/lib/roles.ts` (`can(role, permission)`); pages, server actions and the API principal all ask it.

### Guards

- `src/proxy.ts` (Next 16's request proxy) only redirects visitors without a session cookie
  away from app pages. It is a convenience, never the check.
- Every page and layout under `/w/[slug]` calls `requireWorkspace(slug)`, which loads the
  session, the workspace and the membership in one query and calls `notFound()` when any is
  missing.
- Every server action goes through `workspaceAction(permission, schema, handler)` or
  `userAction(schema, handler)` (`src/server/actions/action.ts`): session, membership for the workspace named in the input,
  the permission check, then input validation. Handlers receive a typed `ActionContext` and
  never read the session themselves. Errors come back as `{ ok: false, error, field? }`, so a
  form can point at the field that needs fixing.
- Browser calls to `/api/v1` with a session cookie must send `X-Workspace` and come from the
  app's own origin; cross-site requests and requests without the header are refused.

## Data

PostgreSQL 16 or later. One `postgres()` pool per process (`src/server/db.ts`).

`pnpm --filter web db:migrate` (and the app on start when `AUTO_MIGRATE=true`) runs the sign
server's migrations, then the app's, each recorded and taken under an advisory lock. App
migrations are plain SQL in `src/server/db/migrations.ts`, append only, never edited once
released.

| Table                  | Holds                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `auth_users`           | Person: name, email (unique, lower-case), avatar, email verified.                           |
| `auth_sessions`        | Better Auth sessions (token, expiry, IP, user agent).                                       |
| `auth_accounts`        | Linked sign-in methods (Google).                                                            |
| `auth_verifications`   | Magic-link tokens.                                                                          |
| `app_workspaces`       | `id`, `slug` (unique, used in URLs), `name`, `created_by`.                                  |
| `app_members`          | `(workspace_id, user_id)` primary key, `role`.                                              |
| `app_invitations`      | `workspace_id`, `email`, `role`, token SHA-256, expiry (7 days), accepted / revoked times.  |
| `app_brand_settings`   | One row per workspace; see Branding.                                                        |
| `app_api_keys`         | `workspace_id`, name, SHA-256 of the key, a display prefix, created by, last used, revoked. |
| `app_user_preferences` | `user_id`: theme, timezone, language.                                                       |
| `sign_*`               | The sign server's own tables, now with `sign_envelopes.workspace_id`.                       |

Ids are prefixed random strings (`ws_…`, `key_…`, `inv_…`). Secrets (API keys, invitation
tokens) are 32 random bytes, shown once, stored only as SHA-256.

API keys look like `cvs_<43 base64url characters>`. The app's `authenticate` hook hashes the
presented key, finds the unrevoked row and returns its workspace; it updates `last_used_at` at
most once a minute.

## Branding

Brand settings belong to a workspace and are read through `getBrand(workspaceId)`, which
fills in Codevibe defaults for anything unset:

| Setting                     | Notes                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo                        | PNG, JPEG or WebP, up to 512 KB, checked by its bytes. SVG is refused (scripts). Served from `/brand/<workspaceId>/logo` with `nosniff` and a sandbox CSP. |
| Brand colour                | `#rrggbb`. Buttons on the signing page use it; text colour is picked for 4.5:1 contrast.                                                                   |
| Font                        | `inter`, `space-grotesk`, `system`, `serif`.                                                                                                               |
| Email sender name, reply-to | The `From` address stays the operator's, so SPF and DKIM keep passing.                                                                                     |
| Email template overrides    | JSON of subject and intro text per mail kind; rendered through the server's `MailTemplates`.                                                               |
| Signing-page custom domain  | Stored with a verification time; served once DNS is verified (signing lane).                                                                               |
| Certificate footer          | A line printed on the certificate page.                                                                                                                    |
| "Secured by Codevibe Sign"  | Badge on the signing page and in emails; on by default.                                                                                                    |

This lane builds the logo, colour, font and sender name settings with a live preview of the
signing-page header; the other columns exist and are filled in by later lanes.

## Personal settings

Theme (`system`, `light`, `dark`), timezone (IANA name, default from the browser on first
sign-in) and language (`en` for now). The theme is also kept in a `cvs_theme` cookie so the
first paint is already in the right theme.

## UI system

- **Palette**: navy `#0D1B2A` for structure (sidebar, headings, table headers), blue
  `#1B6AE0` for actions and focus, teal `#2DD4BF` as the accent (active nav, success, the
  brand mark). Surfaces are tinted (`#F4F6FA` canvas, white cards with a visible border), so
  nothing is white on white. Dark mode uses a navy canvas and lifted navy cards.
- **Type**: Space Grotesk for headings, Inter for body, both self-hosted at build time by
  `next/font`.
- **Tokens**: CSS variables on `:root` and `[data-theme=dark]`, exposed to Tailwind v4 with
  `@theme`. Components use tokens only (`bg-surface`, `text-muted`, `border-line`), never raw
  colours, so dark mode and later re-theming are one file.
- **Primitives**: Radix for dialogs, dropdown menus, selects, tabs and tooltips (focus
  management, keyboard, ARIA). Our wrappers live in `src/components/ui`.
- **Layout**: a navy sidebar with the workspace switcher and the four sections, a top bar with
  the page title, primary action and the user menu. Below 768 px the sidebar becomes a drawer;
  everything works at 390 px wide.
- **Feedback**: toasts for results, inline field errors for validation, empty states that
  say what to do next, and error pages that offer a way back.
- **Accessibility**: WCAG 2.2 AA contrast in both themes, visible focus rings, labels on every
  control, reduced motion respected.

## Folder layout

```
apps/web/src
├─ app/                     routes only: pages, layouts, route handlers
│  ├─ (auth)/sign-in        magic link + Google
│  ├─ onboarding            create the first workspace
│  ├─ invite/[token]        accept an invitation
│  ├─ w/[slug]/             the workspace shell: dashboard, envelopes, templates, settings
│  ├─ sign/                 signing page (signing lane)
│  ├─ brand/[workspaceId]/logo   public logo file
│  └─ api/                  auth, v1, sign, health
├─ components/{ui,shell,settings}
├─ lib/                     shared by server and client: roles, brand colours, preferences
├─ server/                  server only ('server-only')
│  ├─ env.ts, db.ts, runtime.ts, migrate.ts, db/migrations.ts
│  ├─ auth/                 Better Auth config and instance, session, page guards
│  ├─ actions/              server actions, one file per area, all through action.ts
│  ├─ workspaces.ts, members.ts, invitations.ts, brand.ts, api-keys.ts, preferences.ts
│  ├─ sign/                 the mounted sign server, principal resolver, in-process client
│  └─ mail.ts               app mail (magic links, invitations)
├─ instrumentation.ts       migrations on start and the tick timer
└─ proxy.ts                 redirects visitors without a session cookie
```

## Extension points for the next lanes

| Lane                       | Starts from                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Dashboard and send flow    | `app/w/[slug]/page.tsx`, `app/w/[slug]/envelopes/page.tsx`; `signRequest()` and `GET /v1/envelopes`.                  |
| Signing pages and branding | `app/sign/page.tsx`; `getBrand()`; `brand` columns; per-workspace mail templates via `MailTemplates`.                 |
| Templates and bulk send    | `app/w/[slug]/templates/page.tsx`; `@codevibe_technology/sign-templates`; a `app_templates` table keyed by workspace. |
| Webhooks UI                | `webhookTargets()` in `src/server/sign/webhooks.ts` reads an `app_webhooks` table (to add).                           |
