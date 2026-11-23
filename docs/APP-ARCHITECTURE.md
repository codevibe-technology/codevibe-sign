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

### Public records

A completed envelope gets a public record at `/r/<id>`: the page the QR code on its signing
certificate opens. The id is 18 random bytes (144 bits) as base64url, made when the envelope is
sealed (`certificateDetails` hook, `app_public_records`); it is not the envelope id and says
nothing about it.

- The page shows the seal status (the stored sealed file is verified and its SHA-256 compared
  with the one recorded at sealing), title, completion time, sender, signers with masked
  contact details, both fingerprints and the audit trail with the chain check. The view is
  built field by field in `src/server/public-records.ts`: no IP address, browser, event data,
  message, typed value or file key can reach it. The signed document is never served there.
- Downloads: the certificate as its own PDF, and the audit trail as PDF or JSON, built from the
  same stripped data.
- Whoever may void the envelope may turn its record off and on again. A workspace can turn
  records off in Settings (default on): no new records are made, certificates carry no QR
  code and existing links stop answering. A revoked record, a workspace with records off and
  an unknown id all answer the same 404.
- `noindex` (meta, `X-Robots-Tag` and robots.txt), `Referrer-Policy: no-referrer`, no cache, no
  third-party requests, and at most 60 views or downloads per client address in ten minutes.
- The link uses `APP_URL`, so a self-hosted install prints its own host.

### Workspace addresses

A workspace lives at `/dashboard/<slug>`. People choose the slug when they create the
workspace: the form suggests one from the name (Latin letters, with Hindi, Bengali, Gurmukhi,
Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam written out in Latin letters, and
`workspace` when nothing can be) and says while they type whether it is free. The rules live
in `src/lib/workspace-address.ts` and the browser and the server share them: 3 to 40
characters, lower-case letters, digits and single inner hyphens, and none of the reserved words
the app uses for its own pages (`dashboard`, `api`, `docs`, `settings`, `admin`, `new`,
`sign`, `verify`, `www` and a few more).

- `GET /api/workspaces/address?slug=…[&workspace=<id>]` answers `available`, `current`,
  `taken` (with up to three free alternatives) or `invalid`, for signed-in people only, at most
  120 checks per person and 300 per client address in ten minutes. A recently retired address
  answers `taken` like one in use, so it reveals nothing about other workspaces.
- Claiming an address (create or change) takes a transaction-level advisory lock per address,
  then checks again, so two people cannot take the same one; the unique index on
  `app_workspaces.slug` is the last guard, and its error comes back as a field error.
- **Settings → Workspace** shows the address as fixed text. Admins and owners change it with
  **Change address**, which runs the same live check and says what happens. The old slug goes
  into `app_workspace_slug_history`; a member who opens any page under it is redirected with
  `308` to the same page at the new address (`requireWorkspace`, and `workspaceNotFound` in
  route handlers; the proxy passes the path in `x-cvs-path`). People outside the workspace
  still get 404. Links in emails already sent keep working the same way.
- No other workspace can take an old address for 90 days; after that it may, and the redirect
  stops. A workspace can take back its own old address at any time. A workspace can change its
  address five times in 30 days. Each change is recorded in `app_workspace_address_changes`.
- API keys, webhooks, signing links, the live stream and every server action use the
  workspace id, so none of them notice a change. The HTTP API never exposes the slug.

### Self-hosted, cloud

- **Cloud**: anyone may sign up and create workspaces; a person can belong to many and switch
  between them.
- **Self-hosted, one workspace** (`SINGLE_WORKSPACE=true`): the first person to sign in creates
  the workspace; after that nobody can create another, and new people join by invitation only.
  Nothing else differs, so a self-hosted install can later move to the cloud by copying rows.

## Accounts and sessions

Better Auth runs at `/api/auth/*` with:

- **Email magic link** (plugin `magicLink`): links expire after 10 minutes and work once. In
  development (`MAIL_TRANSPORT=console`) the link is printed to the server console. This is
  how an account is created.
- **Email and password**, for people who have an account: sign-up by password is off
  (`disableSignUp`). A password is set in personal settings, by "Forgot password" (a 30-minute
  link by email, which signs every session out), or on the invitation page by someone invited
  who has no account yet. `guardPasswords` wraps the handler with the rules the library lacks:
  the common-password check on every new password, and a pause on an address after five wrong
  passwords in fifteen minutes. See "Passwords for senders" in the threat model.
- **Google** when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; the button is hidden
  otherwise.
- Database sessions in an HttpOnly, `SameSite=Lax`, `Secure` (on https) cookie, 30 days,
  refreshed daily. Telemetry is off.

After signing in, everyone lands on `/dashboard`, which opens their workspace at
`/dashboard/[slug]` (or onboarding when they have none); a `next` parameter may name another
path on the same site. The public home page stays public and shows a signed-in visitor a
Dashboard button. The app used to live under `/w`; those paths redirect.

Everyone has their own name on their account. An emailed link creates an account without one,
so the first step after it asks: onboarding asks beside the workspace name, and the invitation
page asks before joining, starting from the name the inviter typed if they gave one. It can be
changed in personal settings, and a member who still has none sees a prompt in the dashboard
that can be closed for the session. One rule (`src/lib/person-name.ts`, shared by the forms and
the server) covers every one of these: 2 to 80 characters after trimming, letters of any
script, no control characters. `displayName` in the same file is what the app calls someone:
their name, or their email address only when no name is saved. A name is only ever changed
for the signed-in person, by the id in their session.

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
| Bulk send from a template; stop a bulk send          |        |   ✓    |   ✓   |   ✓   |
| Workspace name, brand, API keys, webhooks            |        |        |   ✓   |   ✓   |
| Invite and remove members, admins and viewers        |        |        |   ✓   |   ✓   |
| Make or remove owners, delete the workspace          |        |        |       |   ✓   |

A workspace always keeps at least one owner. Permissions live in one table in
`src/lib/roles.ts` (`can(role, permission)`); pages, server actions and the API principal all ask it.

### Guards

- `src/proxy.ts` (Next 16's request proxy) only redirects visitors without a session cookie
  away from app pages. It is a convenience, never the check.
- Every page and layout under `/dashboard/[slug]` calls `requireWorkspace(slug)`, which loads the
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

| Table                           | Holds                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `auth_users`                    | Person: name, email (unique, lower-case), avatar, email verified.                                           |
| `auth_sessions`                 | Better Auth sessions (token, expiry, IP, user agent).                                                       |
| `auth_accounts`                 | Linked sign-in methods (Google) and the password hash.                                                      |
| `auth_verifications`            | Magic-link tokens.                                                                                          |
| `app_workspaces`                | `id`, `slug` (unique, used in URLs), `name`, `created_by`.                                                  |
| `app_workspace_slug_history`    | `slug` (primary key): an old address, the workspace it leads to and when it was given up.                   |
| `app_workspace_address_changes` | Who changed a workspace's address, from what to what, and when.                                             |
| `app_public_records`            | `id` (the random id in `/r/<id>`), `workspace_id`, `envelope_id` (unique), when it was revoked and by whom. |
| `app_members`                   | `(workspace_id, user_id)` primary key, `role`.                                                              |
| `app_invitations`               | `workspace_id`, `email`, optional `name`, `role`, token SHA-256, expiry (7 days), accepted / revoked.       |
| `app_brand_settings`            | One row per workspace; see Branding.                                                                        |
| `app_api_keys`                  | `workspace_id`, name, SHA-256 of the key, a display prefix, created by, last used, revoked.                 |
| `app_user_preferences`          | `user_id`: theme, timezone, language.                                                                       |
| `app_templates`                 | `workspace_id`, name, description, `definition` (roles, fields, documents, settings), archived time.        |
| `app_bulk_sends`                | One bulk send: template, who started it, status (`sending`, `done`, `cancelled`), total, worker lease.      |
| `app_bulk_send_rows`            | `(bulk_id, line)`: the people and metadata for one envelope, its status, envelope id or error.              |
| `app_webhooks`                  | `workspace_id`, URL (unique per workspace), description, events, signing secret, on or off.                 |
| `app_webhook_deliveries`        | `(webhook_id, delivery_id)`: event, exact body, status, attempts, last answer, next retry; kept 30 days.    |
| `app_usage`                     | `(workspace_id, metric, period)`: envelopes sent per month, API-key requests per day, stored bytes.         |
| `app_plan_changes`              | Who moved a workspace from one plan to another, and when.                                                   |
| `app_subscriptions`             | One Cloud subscription per workspace: term, dates, extra members, status.                                   |
| `app_install_bookings`          | A booking for installation help: contact, server, time, paid and notified times.                            |
| `app_first_run`                 | The sample envelope of a new Free workspace and whether its "Start here" card was dismissed.                |
| `sign_*`                        | The sign server's own tables, now with `sign_envelopes.workspace_id`.                                       |

### Time zones

Two zones matter, and they are kept apart:

- **The reader's zone, on screen.** Every date and time in the app goes through `LocalTime`
  (`src/components/ui/local-time.tsx`): the zone saved in personal settings when there is one,
  otherwise the browser's. A time of day always has its zone next to it
  (`23 Nov 2026, 00:23 GMT+5:30`); a bare day or "5 min ago" names it on hover. The server only
  knows a zone someone saved, so without one the HTML says the time in UTC and the browser
  swaps it on load.
- **The workspace's zone, on paper.** `app_workspaces.time_zone` (Settings, Workspace) is
  the zone for the dates printed on signed documents, the local time on the certificate page
  and the expiry written in emails. Null means the install's default, `SIGN_TIME_ZONE`, or UTC
  when that is unset. The signing page shows the signing date in this zone and says which zone
  it is, so a signer elsewhere sees the date that will be printed. The certificate always
  shows UTC as well.

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
| Email sender name, reply-to | The `From` address stays the operator's, so SPF and DKIM keep passing; only its display name changes.                                                      |
| Email template overrides    | Subject and opening text per email (invite, reminder, completed, cancelled) with `{{variables}}`; sent through the server's `workspaceMail` hook.          |
| Signing-page custom domain  | Stored, unique across workspaces, with a verification time that resets when it changes. Routing and TLS are deployment work (below).                       |
| Certificate footer          | A line printed at the end of the certificate, through the server's `certificateNote` hook. Empty means the default line naming the verify page.            |
| "Secured by Codevibe Sign"  | Badge on the signing page and in emails; on by default.                                                                                                    |

**Settings → Brand** has three cards: the look (logo, colour, font, with a preview of the
signing-page header), emails (sender name, reply-to and the four templates with a live
preview) and the signing page (badge, certificate footer, custom domain with its DNS record).

### Branded emails

`src/lib/mail-templates.ts` renders every recipient email from the brand: a header in the
brand colour with the logo (as an absolute URL), the opening text, the sender's message, the
button and a footer with the badge when it is on. It is pure and shared, so the settings page
previews exactly what is sent; the preview is a sandboxed `iframe` (`sandbox=""`, no scripts).
Overrides are plain text: every value, variable and override is HTML-escaped, line breaks are
removed from subjects, and a variable an email does not offer is refused when saving, with the
field named.

| Variable             | Filled with                                      | In               |
| -------------------- | ------------------------------------------------ | ---------------- |
| `{{recipient_name}}` | The recipient's name                             | all              |
| `{{document_title}}` | The envelope title                               | all              |
| `{{company}}`        | Sender name, or the workspace name               | all              |
| `{{action}}`         | `sign` or `approve`                              | invite, reminder |
| `{{expires_on}}`     | Expiry date (`YYYY-MM-DD`), or empty             | invite, reminder |
| `{{status}}`         | `was declined`, `has expired` or `was withdrawn` | cancelled        |

`src/server/sign/mail.ts` turns the brand into the sign server's `workspaceMail(workspaceId)`
answer: templates, `fromName` (sender name or workspace name) and `replyTo`. Envelopes in the
`default` workspace (API keys without a workspace) keep the server's own templates. One-time
code emails still use the server's plain template.

### Custom signing domains

Saving a domain stores it (lower case, unique across workspaces) and shows the CNAME record to
add: the domain pointing at the app's host. Nothing serves it yet. To turn one on, the
operator:

1. checks the CNAME resolves to the app host and sets `signing_domain_verified_at`;
2. adds the domain to the reverse proxy with a certificate (for example Caddy on-demand TLS
   asking an allow-list endpoint, or a certificate per domain), proxying to the same app;
3. makes signing links for that workspace use it, by giving `createSignServer` a
   `signingUrl` that looks the workspace up, and lets `/api/sign/*`, `/api/v1/sign/*`,
   `/sign` and `/brand/*` through on that host only.

Cookies are host-only, so the whole signing session has to stay on the domain the link was
opened on. Today the link route redirects to `signingPageUrl`, which is the app URL; serving a
custom domain also needs that redirect to go to `/sign` on the host the request came in on.

## Signing

The person signing never signs in. Their link is `${APP_URL}/api/sign/<token>`, which puts
the token in an HttpOnly cookie for `/api/v1/sign` and redirects to `/sign`.

| Step           | What the page does                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open           | `GET /api/v1/sign/link`; then `GET /brand/<workspaceId>/signing` for the header (public, like the logo: name, logo, colour, font, badge).                                     |
| Not their turn | `canAct` is false: says someone else signs first and that an email will follow.                                                                                               |
| Code           | OTP recipients ask for a code (`POST link/otp`), type it (`link/otp/verify`); wrong, expired and locked codes each say what to do next.                                       |
| Consent        | Who asks, the title, the sender's message, the documents; the signer must tick the agreement to sign electronically. Continuing posts `link/view`.                            |
| Document       | `SigningView` from `sign-react`, fitted to the window so the action bar stays on screen: Start/Next/Sign guide, required counter, Finish (Approve for approvers), Decline.    |
| Thank you      | After submit, polls `GET /api/v1/sign/receipt` (3 s while sealing, 15 s while others sign, 10 minutes at most) and offers "Download your copy" once every document is sealed. |

- **Dead links**: a link that is used, expired, withdrawn, declined or complete redirects to
  `/sign?state=<why>&w=<workspaceId>`, and the page explains it in the sender's brand. If the
  cookie is gone but this browser signed earlier, the receipt cookie takes the signer back to
  the thank-you page.
- **SMS**: codes go out by email only (`mailOtpSender`). `SMS_CODES` in
  `src/server/sign/server.ts` is false, so recipients set to SMS see that text messages are not
  available here and are asked to have it sent to their email.
- **Brand on the page**: the header takes the brand colour and logo; the colour also drives
  buttons and focus rings through the `--primary` tokens, so the page keeps following the
  light or dark theme. The "Secured by Codevibe Sign" badge shows unless the workspace turned
  it off.
- **Layout**: one column from 390 px up; headings take focus when the step changes; every
  control has a label; errors are announced.

## Templates

A template is a set of PDFs, roles (Employee, HR manager) and fields placed for those roles,
plus the envelope's default title, message, expiry, reminders and signing order. It lives in
`app_templates` with its PDFs in the file store under
`templates/<workspaceId>/<templateId>/<documentId>.pdf`.

- **Editor** (`/dashboard/[slug]/templates/new`, `/[id]/edit`): Documents, Roles, Fields, Details. It
  reuses the send flow's documents step, field placer and stepper; roles stand in for
  recipients. Each picked PDF is checked and kept under `staged/<workspaceId>/<random>.pdf`
  (`stageTemplateDocumentAction`); saving moves the staged files into the template, so no
  request carries more than one PDF. A saved template keeps its documents: fields stay where
  they were placed, and other files mean a new template.
- **Checks**: `src/lib/templates.ts` holds the rules the editor shows (roles named once, a
  signer or approver, a signature for every signer, a name); the server runs the same rules
  and also checks every field sits on a page of one of the documents.
- **List**: Active and Archived, with Use, Bulk send, Edit, Duplicate (copies the PDFs too) and
  Archive or Restore. Viewers see the list only.
- **Send** (`/[id]/send`): one name and email per role (and a mobile for SMS codes), with the
  title and message prefilled. `sendFromTemplate` reads the PDFs from storage and calls
  `POST /v1/envelopes` in-process with `send: true`, as the member, and records them as the
  sender. Envelopes carry `metadata.templateId`.

## Bulk send

`/dashboard/[slug]/templates/[id]/bulk` takes a CSV of up to 500 rows (1 MB). Columns are
`<Role> name`, `<Role> email`, `<Role> phone` and `meta.<key>`, read with
`@codevibe_technology/sign-templates`' `parseBulkCsv`; a role without columns gets one person
for every row, typed in on the page. The page shows each problem with its row and column and
marks the cell; problem rows are sent only when the sender ticks "skip". Columns that would
prefill a field are refused for now (the API has no prefill on create).

Starting a bulk send reads the CSV again on the server, stores one row per envelope and
returns at once. A worker in the app process (`runBulkSend`) sends rows one by one as the
member who started it, after checking they may still send. When the API's per-minute limit
(60 by default) answers 429, the worker waits and carries on; each send holds a two-minute
lease, so the tick picks up sends left by a restart and two processes never send the same row.
The progress page polls every 2 s, lists every row with its envelope or error, offers the rows
not sent as a CSV to fix, and can stop the send. Envelopes carry `metadata.bulkSendId` and
`bulkSendLine`.

## Webhooks

**Settings → Webhooks** (admins) adds endpoints: URL, description and events (all, or a
picked list). The signing secret (`whsec_…`) is shown once with a copy button, and **New
secret** replaces it at once. Endpoints can be edited, turned off and removed.

- `webhookTargets(workspaceId)` (`src/server/sign/webhooks.ts`) reads the enabled endpoints;
  the sign server asks it when an event happens and again before each delivery, so turning
  one off stops retries too.
- The sign server's `onWebhookDelivery` hook writes every attempt to `app_webhook_deliveries`:
  delivered, retrying (with the next try), failed (no more tries) or not sent (endpoint off).
- **Send test event** posts a signed `webhook.test` event now (`sendTestWebhook`) and says
  what the receiver answered. **Send again** on a delivery posts the same body under the same
  id to the endpoint's current URL (`redeliverWebhook`). Neither is retried automatically.
- The endpoint page lists the last 30 days of deliveries (all, or failed), each with its
  payload, answer, attempts and a hint on what to fix.
- URLs must be public `https`, checked with the sign server's `checkWebhookUrl` when saved and
  again at delivery. `WEBHOOK_ALLOW_INSECURE=true` allows `http://` and private hosts for a
  receiver on your own machine.
- Secrets are stored as they are, because each delivery is signed with them.

## Live updates

Open envelope, list and dashboard pages update when something happens, without polling.

- The sign server calls `onEnvelopeChange({ workspaceId, envelopeId, actions })` after every
  saved change. The app sends it as `NOTIFY cvs_envelope_changes` with ids and action names
  only (`src/server/live/events.ts`), so every web process hears it.
- Each process keeps one `LISTEN` connection (`liveHub()`, `src/server/live/live.ts`) and
  fans changes out in memory by workspace. After the connection comes back it tells every
  subscriber to `resync`, since notifications sent meanwhile are lost.
- `GET /api/live/workspaces/[workspaceId]/stream` is a Server-Sent Events stream for
  signed-in members of that workspace (404 for anyone else). It sends a comment every 25
  seconds, checks the membership again each time, and unsubscribes on disconnect. Headers
  `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` keep proxies and
  compression from buffering it.
- `LiveUpdates` (`src/components/live`) subscribes, refreshes the page 300 ms after a
  change it shows (when the tab is visible), and shows Live or Reconnecting. EventSource
  reconnects by itself; after a refused connection it tries again with growing delays up to
  30 seconds. The envelopes table reloads its rows, with its own filters, when the page
  hands it fresh data.

## Email log

Every email goes through `loggingMailer` (`src/server/mail-log.ts`), which writes one
`app_mail_log` row per send, sent or failed: workspace, envelope and recipient ids, kind,
recipient address, subject (one-time code emails without the code), the `Message-ID`, the
SMTP error on one line with links removed, and the attachment count and size. Bodies and
links are never stored. The background tick deletes rows after 90 days.

- **Settings → Email log** (admins) lists the latest 200, optionally for one envelope.
- A completed envelope shows per recipient "Copy emailed 14:42" or the failure.
- Completed copies over 5 MB, or whose files cannot be read or are refused by the provider,
  go out with a personal download link per document (30 days) instead of attachments.
- `Message-ID` uses the host of `APP_URL`.
- When an envelope sent from the app is declined, its sender gets an email with who
  declined, their role and the reason.

## Fixing an envelope after sending

The envelope page offers, as roles allow: **Get a link to share** (admins and owners, for
the recipient whose turn it is; shown once, earlier links stop working, 5 per hour),
**Correct** (senders, for anyone who has not acted), **Recall and edit** (whoever may void
it) and **Revise and resend** on a declined envelope. Recall and revise open a draft copy in
the send flow; a revised draft shows why it was declined, can carry a note on what changed
and can have its PDF replaced. Each step is an audit event that links the envelopes both
ways.

## Plans and limits

`app_workspaces.plan` is `free`, `cloud` or `unlimited`. `PLAN_MODE=self-hosted` treats every
workspace as unlimited and shows nothing about plans or billing; `hosted` applies the plan.
Every number lives in `src/lib/plans.ts` and nowhere else: the server checks, the Plan and
usage page, the pricing section and the plan table in the docs are all built from it
(`planFeatures`, `planTableMarkdown`), and a test compares any docs page that carries the
table between its `plans:start` and `plans:end` comments with the module.

|                                   | Free                 | Cloud                                         |
| --------------------------------- | -------------------- | --------------------------------------------- |
| Envelopes sent                    | 10 a month (UTC)     | no plan number                                |
| Members, with open invitations    | 2                    | `CLOUD_INCLUDED_MEMBERS` (25) + `extra_seats` |
| Active templates                  | 2                    | no plan number                                |
| Webhooks                          | not included         | fair use: 10 endpoints                        |
| Rows in one bulk send             | 10                   | fair use: 500                                 |
| API requests                      | 100 a month (IST)    | fair use: 10,000 a day (UTC)                  |
| One PDF, one envelope, all stored | 10 MB, 25 MB, 200 MB | fair use: 25 MB, 100 MB, 20 GB                |
| Own signing domain, badge off     | no                   | yes                                           |
| Own eSign provider account        | no                   | yes                                           |

`FREE_PLAN_LIMITS` (JSON) overrides Free numbers for an install. `app_workspaces.extra_seats`
holds the members a Cloud workspace pays for on top of the included ones.

Limits are enforced where the work happens, never in memory, and with the workspace (or the
person) row locked wherever two requests could otherwise both pass:

| Limit                                  | Where                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelopes sent per month, stored bytes | `createPlanGate` in front of the sign API: reserved in `app_usage` before the server works, given back if it refuses or replays an idempotent answer.                         |
| API requests                           | The same gate, for `Authorization: Bearer` calls only: per India month and per UTC day, whichever the plan has.                                                               |
| PDF size, envelope size                | The gate (create, replace a draft's PDF), and the upload checks of the send flow and the template editor.                                                                     |
| Members (with open invitations)        | `createInvitation` and `acceptInvitation`, with the workspace row locked.                                                                                                     |
| Active templates                       | Create (editor and `POST /v1/templates`), duplicate and restore, with the workspace row locked.                                                                               |
| Webhooks                               | `createWebhook` and `setWebhookEnabled` (locked), test events and redeliveries (`assertWebhooksLive`), and `webhookTargetsFor`, which the sign server asks before every send. |
| Rows per bulk send                     | `startBulkSendAction`, before a row is stored; it also refuses more rows than sends left this month, and each row is then counted by the gate as it is sent.                  |
| Custom domain, badge                   | `updateSigningSettings`; `getBrand` always shows the badge where the plan requires it.                                                                                        |
| Workspaces per owner                   | `createWorkspace`, and `assertCanOwn` when someone is made an owner or accepts an owner's invitation, with the person's row locked.                                           |
| Own eSign provider account             | `assertOwnEsignAccount`, when the account is saved and each time it is about to be used.                                                                                      |

The gate matches on the path the router will see: percent-escapes decoded (`routedPath`),
repeated slashes folded, dot segments already resolved by the URL parser. It covers
`POST /v1/envelopes`, `POST /v1/envelopes/:id/send`, `POST /v1/templates/:id/envelopes`,
`PUT /v1/envelopes/:id/documents/:docId` (file size, envelope size, and the bytes the new file
adds or frees) and `POST /v1/envelopes/:id/recall|revise` (the copy's bytes). Every call to the
sign server passes it; `handleSignRequest` is the only caller of `app.fetch`.

**API requests.** Every call made with an API key counts once it is authenticated, whatever
the server then answers, errors included. A call refused for the count itself is not counted.
Calls the app makes for a signed-in person do not count. Free counts by the calendar month in
India time, starting again on the 1st at 00:00 IST; Cloud has a daily fair-use ceiling in UTC.
Over the count the answer is `429` with `Retry-After` and `details.resetsAt`.

Every refusal is a `PlanLimitError` (`code: 'PLAN_LIMIT'`) whose message names the limit, the
usage and what to do. The API answers `403` (`429` for API requests) with
`details: { limit, used, max, plan, upgradeUrl, resetsAt? }`; a server action returns the same
details as `limit` next to the message, for the upgrade prompt.

**A workspace over its limits** (an existing Free workspace when the limits changed, or one
that left Cloud) keeps everything it has. Its members stay members, its templates stay usable
and editable, its envelopes and files stay. It cannot add to what is over: no new invitation
or member, no new, duplicated or restored template, until it is back under the limit. Webhooks
are not part of Free, so its endpoints stay listed and can be edited, turned off or removed,
but receive nothing: no new event is queued, deliveries waiting to be retried stop, and test
events and redeliveries are refused. A connected eSign provider account is not used. A custom
signing domain stops applying and the badge shows again. Moving to Cloud brings all of it
back as it was.

The matrix in `test/plan-matrix.db.test.ts` runs every entry point on Free, Cloud, Unlimited
and a self-hosted install, and fails when a server action or a changing route of the sign API
is not listed in it.

## Paying for Cloud and installation help

Sold through the order engine in `src/server/billing` (`createOrder`, `confirmCheckout`,
`fulfilOrder`), the same one that sells eSign credits and issues GST invoices. Each kind of
order registers what paying for it delivers, and that runs once, inside the transaction that
marks the order paid.

**Terms, not mandates.** A Cloud term is one month or one year (twelve calendar months,
charged as `CLOUD_ANNUAL_MONTHS`), paid up front. Nothing is charged automatically, so the
whole flow works with test keys and needs no stored payment method. `app_subscriptions` holds
one row per workspace: the term, its start and end, the extra members of this term and of the
next, and a status of `active`, `grace` or `ended`.

| Step                | Rule (`src/server/billing/subscriptions.ts`)                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First term          | Starts when the payment is confirmed; sets `plan = 'cloud'` and `extra_seats`, and records the change in `app_plan_changes`.                                                  |
| Next term           | Can be paid in the last 7 days or in the grace days. It starts where the paid term ends, whenever it is paid.                                                                 |
| Extra members       | Mid-term: the term price of a member times the days left over the days in the term, half a paisa rounded up (`proratedPrice`). Effective at once and included in later terms. |
| Fewer members       | `renewal_seats` only; the current term keeps what was paid for. No refunds.                                                                                                   |
| Cancel              | `cancel_at_period_end`; Cloud stays until the term ends, then the workspace is Free. Can be undone until then.                                                                |
| Not renewed         | `grace` for `CLOUD_GRACE_DAYS` (7), then `ended`: `plan = 'free'`, `extra_seats = 0`. Nothing is deleted; the rules for a workspace over the Free limits apply.               |
| Set by the operator | A paid plan with no subscription row (`plan:set`) is never sold, reminded or ended here.                                                                                      |

Dates are calendar months in India time (`addMonths` in `src/lib/billing/terms.ts`): a term
that starts on 31 January ends on the last day of February.

`runSubscriptionTick` runs from the background timer. It sends reminders 7, 3 and 1 days before
a term ends (to the billing address and the owners), starts the grace days and ends
subscriptions. Every step is a guarded update or runs under the workspace row lock, the same
lock the plan checks take, so several processes or a repeated run change nothing more. Each
transition writes `app_audit_log` (`subscription.started`, `renewed`, `seats_changed`,
`cancel_scheduled`, `cancel_undone`, `grace_started`, `ended`).

Prices reach a page only as finished text from `pricingView` (`src/server/billing/pricing.ts`):
the Cloud prices, the price of one Aadhaar eSign on each plan, or "Price coming soon". How a
price is made up never leaves the operator's settings. The home page, the Plan and usage page
and the upgrade prompt (`components/billing/upgrade-prompt.tsx`, shown for every `PLAN_LIMIT`
refusal) all read from there and from `planFeatures`.

**Installation help** (`/install-help`, hosted only) is a public purchase with no account: the
form is checked with the billing details rules, refuses text that looks like a pasted
password, and is limited per address and overall. The booking is stored in
`app_install_bookings`, paid through an order without a workspace, invoiced by email, and the
operator is told at `OPERATOR_EMAIL` once, with retries from the timer. "Need a server?" lists
`HOSTING_OFFERS` and is absent while that is empty.

## Extension points for the next lanes

| Lane                    | Starts from                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Custom signing domains  | `signing_domain` and `signing_domain_verified_at`; the steps under Custom signing domains.            |
| SMS codes               | An `OtpSender` for SMS in `src/server/sign/server.ts`, then `SMS_CODES = true`.                       |
| Prefill from a template | Needs `values` on `POST /v1/envelopes`; then lift the refusal of prefill columns in `previewBulkCsv`. |
| Templates over the API  | `/v1/templates` routes in the app that call `sendFromTemplate`, guarded by API keys.                  |
