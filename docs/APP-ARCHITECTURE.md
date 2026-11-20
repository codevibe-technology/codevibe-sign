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
| Bulk send from a template; stop a bulk send          |        |   ✓    |   ✓   |   ✓   |
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

| Table                    | Holds                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `auth_users`             | Person: name, email (unique, lower-case), avatar, email verified.                                        |
| `auth_sessions`          | Better Auth sessions (token, expiry, IP, user agent).                                                    |
| `auth_accounts`          | Linked sign-in methods (Google).                                                                         |
| `auth_verifications`     | Magic-link tokens.                                                                                       |
| `app_workspaces`         | `id`, `slug` (unique, used in URLs), `name`, `created_by`.                                               |
| `app_members`            | `(workspace_id, user_id)` primary key, `role`.                                                           |
| `app_invitations`        | `workspace_id`, `email`, `role`, token SHA-256, expiry (7 days), accepted / revoked times.               |
| `app_brand_settings`     | One row per workspace; see Branding.                                                                     |
| `app_api_keys`           | `workspace_id`, name, SHA-256 of the key, a display prefix, created by, last used, revoked.              |
| `app_user_preferences`   | `user_id`: theme, timezone, language.                                                                    |
| `app_templates`          | `workspace_id`, name, description, `definition` (roles, fields, documents, settings), archived time.     |
| `app_bulk_sends`         | One bulk send: template, who started it, status (`sending`, `done`, `cancelled`), total, worker lease.   |
| `app_bulk_send_rows`     | `(bulk_id, line)`: the people and metadata for one envelope, its status, envelope id or error.           |
| `app_webhooks`           | `workspace_id`, URL (unique per workspace), description, events, signing secret, on or off.              |
| `app_webhook_deliveries` | `(webhook_id, delivery_id)`: event, exact body, status, attempts, last answer, next retry; kept 30 days. |
| `app_usage`              | `(workspace_id, metric, period)`: envelopes sent per month, API-key requests per day, stored bytes.      |
| `app_plan_changes`       | Who moved a workspace from one plan to another, and when.                                                |
| `app_first_run`          | The sample envelope of a new Free workspace and whether its "Start here" card was dismissed.             |
| `sign_*`                 | The sign server's own tables, now with `sign_envelopes.workspace_id`.                                    |

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
| Certificate footer          | A line printed at the end of the certificate, through the server's `certificateNote` hook.                                                                 |
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
| Document       | `SigningView` from `sign-react` with the PDFs from `link/documents/<id>`, "Next field", a required-field counter, Finish (Approve for approvers), Decline with a reason.      |
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

- **Editor** (`/w/[slug]/templates/new`, `/[id]/edit`): Documents, Roles, Fields, Details. It
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

`/w/[slug]/templates/[id]/bulk` takes a CSV of up to 500 rows (1 MB). Columns are
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

## Plans and limits

`app_workspaces.plan` is `free`, `cloud` or `unlimited`. `PLAN_MODE=self-hosted` treats every
workspace as unlimited; `hosted` applies the plan. The limits live in `src/lib/plans.ts` and
are enforced where the work happens, never in memory:

| Limit                                  | Where                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Envelopes sent per month, stored bytes | `createPlanGate` in front of the sign API: reserved in `app_usage` before the server works, given back if it refuses. |
| API-key requests per day               | The same gate, for `Authorization: Bearer` calls only.                                                                |
| PDF size, envelope size                | The gate (create), and the upload checks of the send flow and the template editor.                                    |
| Members (with open invitations)        | `createInvitation` and `acceptInvitation`, with the workspace row locked.                                             |
| Active templates                       | Create, duplicate and restore, with the workspace row locked.                                                         |
| Webhook endpoints                      | `createWebhook`, with the workspace row locked.                                                                       |
| Rows per bulk send                     | `startBulkSendAction`, which also refuses more rows than sends left this month.                                       |
| Custom domain, badge                   | `updateSigningSettings`; `getBrand` always shows the badge where the plan requires it.                                |
| Free workspaces per owner              | `createWorkspace`, with the user's row locked.                                                                        |

Every refusal is a `PlanLimitError` (`code: 'PLAN_LIMIT'`) whose message names the limit, the
usage and what to do; the API answers `403` with `details: { limit, used, max, plan }`.

## Extension points for the next lanes

| Lane                    | Starts from                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Custom signing domains  | `signing_domain` and `signing_domain_verified_at`; the steps under Custom signing domains.            |
| SMS codes               | An `OtpSender` for SMS in `src/server/sign/server.ts`, then `SMS_CODES = true`.                       |
| Prefill from a template | Needs `values` on `POST /v1/envelopes`; then lift the refusal of prefill columns in `previewBulkCsv`. |
| Templates over the API  | `/v1/templates` routes in the app that call `sendFromTemplate`, guarded by API keys.                  |
