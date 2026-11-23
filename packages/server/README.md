# @codevibe_technology/sign-server

The HTTP API and runtime for Codevibe Sign. It stores envelopes, mails signing links and
one-time codes, runs signing sessions, delivers signed webhooks and produces the sealed PDF
with its certificate page. It is a [Hono](https://hono.dev) app, so you can mount it in your
own server or run it on its own.

This package is licensed under AGPL-3.0-only, unlike the Codevibe Sign libraries, which are
Apache-2.0. Running it unchanged, or calling its API from your own product, asks nothing of
you; see [Licence](#licence).

The rules (who signs when, reminders, expiry, the audit chain) come from
`@codevibe_technology/sign-core`; drawing, the certificate page and the PAdES seal come from
`@codevibe_technology/sign-pdf`.

## Install

```sh
pnpm add @codevibe_technology/sign-server
```

Node 22 or later.

## Run it from the command line

The package ships a `codevibe-sign-server` command. Try the server with nothing to set up:

```sh
npx @codevibe_technology/sign-server start --memory
```

`--memory` keeps everything in memory, seals with a generated self-signed certificate, prints
emails and one-time codes to the terminal and prints a fresh API key. It is for local
development only: everything is gone when it stops.

Without `--memory` it runs the same service as the Docker image, from the same environment
variables:

```sh
npx @codevibe_technology/sign-server start
npx @codevibe_technology/sign-server start --seal seal.p12 --public-url https://sign.example.com
```

It reads `DATABASE_URL`, `PUBLIC_URL`, `API_KEYS`, `SEAL_P12_BASE64`, `SEAL_P12_PASSPHRASE`,
`SMTP_HOST`, `SMTP_FROM` and the optional ones in the
[variable reference](https://sign.codevibe.in/docs/getting-started/docker?utm_source=github&utm_medium=readme&utm_campaign=sign-server&utm_content=body).
`--port`, `--host`, `--public-url`, `--database-url`, `--files-dir` and `--seal <file.p12>`
override their variable. Passwords and keys are read from the environment only. Every missing
or invalid variable is reported at once, by name, and `Ctrl+C` lets running work finish before
it exits.

Self-hosting is either this command or the Docker image. To make a development certificate or
an API key, use the Apache-2.0 tools: `npx codevibe-sign keygen --out seal.p12` and
`npx codevibe-sign api-key`.

## Standalone example

```ts check
import { readFileSync } from 'node:fs';
import {
  createSignServer,
  listen,
  localFileStore,
  migrate,
  mailOtpSender,
  postgresStore,
  smtpMailer,
} from '@codevibe_technology/sign-server';

const store = postgresStore(process.env.DATABASE_URL!);
await migrate(store.sql);
const mailer = smtpMailer({ transport: process.env.SMTP_URL!, from: 'Sign <sign@example.com>' });

const sign = createSignServer({
  store,
  files: localFileStore('./data/files'),
  mailer,
  otp: mailOtpSender(mailer),
  sealer: { p12: readFileSync('./seal.p12'), passphrase: process.env.SEAL_PASSPHRASE! },
  apiKeys: [process.env.SIGN_API_KEY!],
  publicUrl: 'https://sign.example.com',
  webhooks: [
    { url: 'https://hr.example.com/hooks/sign', secret: process.env.HOOK_SECRET!, events: ['*'] },
  ],
});

await listen(sign.app, { port: 3000 });
setInterval(() => void sign.tick(), 60_000);
```

`startSignServer(config, overrides?)` does all of the above from one config object
(PostgreSQL, a files directory, SMTP, the seal certificate with optional `reason` and
`location`, API keys, the public URL and an optional `tickIntervalMs`) and returns
`{ server, listen(port, host?), close() }`. `overrides` replaces any built adapter or option,
for example `{ trustProxy: true, trustedProxyHops: 1 }`. `close()` stops accepting requests
and waits for running work before disconnecting.

`configFromEnv(process.env)` reads the same environment variables as the Docker image
(`DATABASE_URL`, `PUBLIC_URL`, `API_KEYS`, `SEAL_P12_BASE64` and the rest) and returns
`{ server, port, host, trustProxy, trustedProxyHops }`, where `server` is the config for
`startSignServer`. It reports every problem at once by variable name and never prints values.

## Secure defaults

These checks are on unless you turn them off, and each opt-out is meant for local
development only.

| What         | Default                                                                                                                                          | Opt-out                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Seal key     | Opened at start-up; the server refuses to start with an unreadable, expired, under-2048-bit RSA or SHA-1 certificate.                            | `sealer.allowWeakKey: true`                                                    |
| Sealed files | Verified with `verify()` against the operator certificate before they are stored. Add old certificates after a rotation in `sealer.trust`.       | none                                                                           |
| Webhook URLs | `https` on a host name; each delivery resolves it, refuses private and reserved addresses, connects to the checked address, no redirects.        | `webhookSecurity: { allowInsecure: true }` or `allowHosts`                     |
| Client IP    | The socket address. Behind your proxies, the `X-Forwarded-For` entry `trustedProxyHops` (default 1) from the right.                              | `trustProxy: true` turns the header on                                         |
| API keys     | Hashed with SHA-256 at start-up and compared in constant time. Pass `{ id, sha256 }` to keep plain keys out of the config.                       | none                                                                           |
| Logs         | Signing tokens, codes, session values, credentials and bodies are removed from every line. `accessLog: true` adds one redacted line per request. | none                                                                           |
| OTP          | 5 codes per 15 minutes and 10 per recipient over the envelope's life; each new code replaces the last; checks are saved atomically.              | `limits.otpCodesPerRecipient`                                                  |
| Signed dates | Dates on signed documents are in UTC; the certificate page shows UTC and, with a zone set, the local time next to it.                            | `timeZone: 'Asia/Kolkata'` (`TIME_ZONE`), or `workspaceTimeZone` per workspace |

## OpenAPI

The whole HTTP API is described in [`openapi.yaml`](openapi.yaml), an OpenAPI 3.1 document
with every route, schema, error code and the webhook payload; `openapi.json` is the same
document as JSON and ships with the package. Each server serves it, without authentication, at
`GET /v1/openapi.json`. The docs site has an
[interactive reference](https://sign.codevibe.in/docs/http-api/reference) and a Postman collection.

## Sending

All sender routes need `Authorization: Bearer <api key>`. POST routes accept an
`Idempotency-Key` header: a retry with the same key and body gets the first response back.

| Route                                                 | What it does                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /v1/envelopes`                                  | Create a draft (JSON with base64 documents, or multipart).                                              |
| `GET /v1/envelopes`                                   | The caller's envelopes, newest first: `?status=draft,sent&q=offer&limit=25&cursor=`.                    |
| `GET /v1/envelopes/:id`                               | The envelope.                                                                                           |
| `PATCH /v1/envelopes/:id`                             | Change a draft: title, message, routing, recipients, fields.                                            |
| `POST /v1/envelopes/:id/send`                         | Send it; the first signers get their links.                                                             |
| `POST /v1/envelopes/:id/void`                         | Withdraw it (`{ "reason": "..." }`).                                                                    |
| `POST /v1/envelopes/:id/remind`                       | Mail a fresh link to whoever's turn it is (`{ "recipientId" }` for one); at most every 15 minutes.      |
| `POST /v1/envelopes/:id/recipients/:rid/link`         | A fresh signing link to pass on yourself; no email, earlier links stop, 5 per hour.                     |
| `PATCH /v1/envelopes/:id/recipients/:rid`             | Correct the name, email or phone of someone who has not acted; a new address is invited.                |
| `POST /v1/envelopes/:id/recall`                       | Void a sent envelope and get a draft copy to edit (`{ "note" }`); returns `{ draft, recalled }`.        |
| `POST /v1/envelopes/:id/revise`                       | Copy a declined envelope to a draft to send again; returns `{ draft, declined }`.                       |
| `PUT /v1/envelopes/:id/documents/:docId`              | Replace a draft's PDF; returns `{ envelope, movedFields }`.                                             |
| `GET /v1/envelopes/:id/events`                        | The audit log and whether its hash chain is intact.                                                     |
| `GET /v1/envelopes/:id/documents/:docId`              | The sealed PDF once complete, else the original (`?version=`).                                          |
| `GET /v1/envelopes/:id/documents/:docId/verification` | `verify()` on the stored sealed file: `{ valid, reason, signer, signedAt, certificateSha256, sha256 }`. |
| `GET /v1/envelopes/:id/certificate`                   | Hashes, recipients and their actions, as JSON.                                                          |

A recipient with an email address signs with `auth: 'email_otp'` unless the request says
otherwise: the signing link plus a six-digit code sent by email. Pass `auth: 'email_link'` when
the link alone is enough, or `sms_otp` with a phone number.

```json
{
  "title": "Offer letter",
  "send": true,
  "documents": [{ "key": "offer", "name": "offer.pdf", "content": "<base64>" }],
  "recipients": [
    { "key": "asha", "name": "Asha Rao", "email": "asha@example.com", "auth": "email_otp" },
    { "key": "hr", "name": "HR", "email": "hr@example.com", "role": "viewer" }
  ],
  "fields": [
    {
      "recipient": "asha",
      "type": "signature",
      "page": 0,
      "x": 72,
      "y": 640,
      "width": 180,
      "height": 48
    }
  ]
}
```

Field boxes are in PDF points from the top-left corner of the page. For multipart uploads,
send the same JSON in a form field named `envelope` and the files as `documents`.

## Templates

A template keeps the PDFs, the roles (Employee, HR), the fields of each role and the envelope
settings. Same API key, workspace rules, `Idempotency-Key` and errors as envelopes; a template
in another workspace answers `404 NOT_FOUND`.

| Route                              | What it does                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /v1/templates`                | The caller's templates, newest first: `?q=offer&limit=25&cursor=`.                                     |
| `POST /v1/templates`               | Create one (JSON with base64 documents, or multipart with the JSON in a `template` field).             |
| `GET /v1/templates/:id`            | The template with its documents, roles and fields.                                                     |
| `PATCH /v1/templates/:id`          | Change the settings, roles or fields. The documents cannot change.                                     |
| `DELETE /v1/templates/:id`         | Remove it and its PDFs. Envelopes already made keep their own copies.                                  |
| `POST /v1/templates/:id/envelopes` | An envelope with a person per role: `{ "roles": { "Employee": { name, email } }, "prefill", "send" }`. |

Templates live in the store (`sign_templates`, migration `0004`). Pass `templateStore` to keep
them in a table of your own, for example with your own quotas; a store without one answers
`409 INVALID_STATE` on these routes.

## Public verification

`POST /v1/verify` (a PDF as multipart `file`, or as an `application/pdf` body) and
`GET /v1/verify/:sha256` say whether a file is exactly what this server sealed:
`{ valid, reason, sha256, checks, signer, signedAt, certificateSha256, envelope }`. For a
valid file `envelope` carries what the certificate page inside it prints: title, signers with
masked contacts, the audit events and the chain head. No IP addresses, no full addresses.

These two routes need no API key, on purpose: whoever is handed a sealed document must be
able to check it. They are limited per client address (`limits.verifyPer10Minutes`, default
30; `verifySharedPer10Minutes` when the address is unknown), to `limits.maxPdfBytes`, and to
`limits.maxConcurrentVerifications` files at a time. The file is parsed under the same limits
as every upload and nothing about it is stored. `server.verifyPdf(bytes)` gives the same
answer to a page of your own.

## Versioning

Every route of the API is under `/v1` and every answer carries `Codevibe-Api-Version: 1`.
An operation marked `deprecated: true` in `openapi.yaml` must also carry `x-deprecated-since`
and `x-sunset` dates at least six months apart; its answers then carry `Deprecation`
(RFC 9745), `Sunset` (RFC 8594) and `Link: <...>; rel="deprecation"`. Nothing is deprecated
today.

## Workspaces

Every envelope belongs to one workspace, fixed when it is created. A sender sees and acts on
its own workspace's envelopes only; any other id answers `ENVELOPE_NOT_FOUND`, the same as an
id that does not exist. A server that never mentions workspaces keeps working unchanged:
keys without a `workspaceId`, and envelopes created before workspaces existed, belong to
`DEFAULT_WORKSPACE` (`'default'`).

```ts check
import { createSignServer, type SignServerOptions } from '@codevibe_technology/sign-server';
declare const base: SignServerOptions;
declare function findKey(sha256: string): Promise<{ id: string; workspaceId: string } | null>;
declare function hooksOf(workspaceId: string): Promise<SignServerOptions['webhooks']>;

const sign = createSignServer({
  ...base,
  apiKeys: [{ id: 'acme-ci', key: process.env.ACME_KEY!, workspaceId: 'ws_acme' }],
  // Keys kept in your own database, or a signed-in user's session.
  authenticate: async (request) => {
    const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!key) return null;
    const digest = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
    ).toString('hex');
    return findKey(digest);
  },
  webhookTargets: async (workspaceId) => (await hooksOf(workspaceId)) ?? [],
  basePath: '/api',
});
```

- `authenticate(request)` runs before the configured keys and returns a principal
  `{ id, workspaceId, readOnly? }`, or null to fall back to `apiKeys`. A `readOnly`
  principal may only use `GET` routes (`FORBIDDEN` otherwise). Do not read the body in it.
- `webhookTargets(workspaceId)` is asked when an event happens and again before each delivery,
  so a removed target stops at once and its secret never sits in the job table. The static
  `webhooks` receive the default workspace's events.
- Idempotency keys and rate limits are kept per workspace and principal.
- `basePath` serves every route under a prefix (`/api/v1/...`, `/api/sign/:token`), cookie
  paths included, for mounting the app inside another framework.
- Custom stores: `commit(..., { workspaceId })` on create, `load()` returning `workspaceId`,
  and `list(workspaceId, query)` for `GET /v1/envelopes`. A store without them holds the
  default workspace only. Migration `0003_workspaces` adds `sign_envelopes.workspace_id`.

## Signing

The React package README shows a signing page built on these routes.

Signing links point at `GET /sign/:token` on `publicUrl` (route that path to this server, or
set `signingUrl`). That request only reads: it stores the token in an HttpOnly,
SameSite=Strict `cvsign_link` cookie and redirects to `signingPageUrl` (default
`${publicUrl}/sign`), a URL without the token, so the token stays out of history, `Referer`
headers and the page's logs. The page then calls the routes below with `link` in place of
the token, for example `GET /v1/sign/link`, from the same origin. Mail scanners that open
links first change nothing: a recipient is marked as having viewed only when the page posts
`/view`.

The routes also accept the token itself in the path. Anything not shaped like an issued token
(43 base64url characters) is refused with `TOKEN_INVALID` before it is hashed or looked up.
Tokens are stored only as hashes and stop working once the signer has acted or the envelope
is completed, declined, voided or expired. A link that no longer works still redirects to
`signingPageUrl`, with `?state=` saying why (`signed`, `completed`, `declined`, `voided`,
`expired` or `invalid`) and `&w=<workspaceId>` when the envelope is known, so the page can
explain it in the sender's brand.

| Route                                   | What it does                                                   |
| --------------------------------------- | -------------------------------------------------------------- |
| `GET /v1/sign/:token`                   | The envelope basics and this signer's own fields.              |
| `GET /v1/sign/:token/documents/:docId`  | The original PDF.                                              |
| `POST /v1/sign/:token/otp`              | Send a one-time code (OTP recipients).                         |
| `POST /v1/sign/:token/otp/verify`       | `{ "code" }`; sets a 30-minute session cookie and returns it.  |
| `POST /v1/sign/:token/view`             | Record that the signer opened the document.                    |
| `POST /v1/sign/:token/submit`           | `{ "consent": true, "values": [{ "fieldId", "value" }] }`.     |
| `POST /v1/sign/:token/decline`          | `{ "reason": "..." }`.                                         |
| `POST /v1/sign/:token/esign`            | Aadhaar signers: same body as `submit`; answers `{ signUrl }`. |
| `GET /v1/sign/:token/esign`             | Aadhaar signers: where the eSign stands; gives the receipt.    |
| `GET /v1/sign/receipt`                  | After signing: status, people still to act, sealed documents.  |
| `GET /v1/sign/receipt/documents/:docId` | After signing: the sealed copy, once everyone has acted.       |

OTP recipients must verify before they can read the document or act. Send the session as
the `cvsign_session` cookie or the `X-Sign-Session` header. Each new code replaces the
previous one; after 10 codes for one envelope, `POST /otp` answers `OTP_LOCKED` with
`details.reason: 'too_many_codes'` and the sender has to send the envelope again.

A successful submit hands back a receipt, as an HttpOnly `cvsign_receipt` cookie and the
`X-Sign-Receipt` header, valid for 7 days. It lets the signer follow the envelope to
completion and download their sealed copy from the receipt routes, without keeping the
signing link alive.

## Aadhaar eSign

A recipient with `auth: 'aadhaar'` signs with Aadhaar eSign through an eSign provider. Pass
`esign` to turn it on; without it an envelope with such a recipient cannot be sent
(`ESIGN_UNAVAILABLE`).

```ts
import { createLeegalityProvider } from '@codevibe_technology/sign-aadhaar';

const leegality = createLeegalityProvider({
  environment: 'sandbox',
  authToken: process.env.LEEGALITY_AUTH_TOKEN!,
  privateSalt: process.env.LEEGALITY_PRIVATE_SALT!,
  profileId: process.env.LEEGALITY_WORKFLOW_ID!,
});

createSignServer({
  // ...
  esign: { provider: async () => leegality },
});
```

How it runs:

1. The signer fills their fields on your signing page and posts them to
   `POST /v1/sign/:token/esign`. The server draws every value on the document, asks the
   provider to sign that file and answers `{ signUrl, expiresAt }`. Send the signer to
   `signUrl`. Asking again while the attempt is open answers the same page.
2. The provider calls `POST /v1/esign/webhooks/<provider name>`. The body names the
   request; the server finds the workspace that started it and verifies the body with that
   workspace's provider before acting. The signing page can also poll
   `GET /v1/sign/:token/esign`, which asks the provider at most once every ten seconds, so a
   late or missing webhook does not leave the signer waiting.
3. When the provider reports the signature, the server fetches the signed file, marks the
   recipient signed (the `recipient.signed` event carries `method: 'aadhaar_esign'`, the
   provider, its reference, the signer name the provider gave and the SHA-256 of the signing
   certificate) and the envelope completes.
4. Sealing never rewrites the provider's file. The seal is added after it as an incremental
   update (`countersign` in the PDF package), so both signatures stay valid, and the signing
   certificate becomes a sealed file of its own: `?version=certificate` on the document
   route, `?file=certificate` on the receipt and copy routes, and a second attachment on the
   completed email. A file the provider locked against further signatures is kept exactly
   as it came and is recognised by its SHA-256 (`seal: 'provider_only'` in the
   `document.sealed` event and in verification answers).

| Option                   | What it does                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider(workspaceId)`  | The `EsignProvider` a workspace signs with, or null. Return your own account, or one built from the workspace's own credentials.                       |
| `available(workspaceId)` | Why the workspace cannot eSign now (`{ reason, message, signerMessage? }`), or null. Asked when the envelope is sent and again when the signer starts. |
| `onStart(input)`         | Called before the provider, for example to reserve a credit. Throw `SignError('ESIGN_UNAVAILABLE', message, { reason })` to refuse.                    |
| `onEnd(input)`           | Called once per outcome (`signed`, `declined`, `expired`, `failed`) with the same `ref` as `onStart`. Retried by `tick()` until it returns.            |
| `webhookRef`             | Reads the provider reference from a callback body for a provider other than Leegality.                                                                 |
| `sessionTtlMs`           | How long the server waits for a started eSign. Default 24 hours, never past the envelope's expiry.                                                     |

`signed` can follow `expired` or `failed` for the same `ref`: the provider may report a
signature after the server stopped waiting, and that signature is still recorded when the
envelope is open. Make `onEnd` idempotent on `ref` and `outcome`.

Rules, checked when the envelope is sent: one recipient may sign with Aadhaar eSign, they
must be a signer, the envelope holds one document, and they act last (sequential routing
when anyone else acts). The reason is the file format: the provider signs the finished
file, and nothing but another signature can be added after that without breaking it.

Sessions live in the store (`store.esign`, table `sign_esign_sessions`, migration
`0005_esign_sessions`); the built-in memory and PostgreSQL stores have it. Field values wait
there until the provider answers. No Aadhaar number reaches the server: the provider
collects it on its own page.

## Email per workspace

`templates` replaces the default emails for the whole server. `workspaceMail(workspaceId)`
goes further: it is asked each time an invitation, reminder, completed copy or cancellation
is sent, and may return templates, a `fromName` and a `replyTo` for that workspace. What it
leaves out comes from `templates` and the defaults; null keeps them unchanged. `fromName`
only changes the display name: `smtpMailer` keeps its own address, so SPF and DKIM still
pass.

```ts check
import {
  createSignServer,
  defaultTemplates,
  type SignServerOptions,
} from '@codevibe_technology/sign-server';
declare const base: SignServerOptions;
declare function brandOf(workspaceId: string): Promise<{ name: string; replyTo?: string }>;

const sign = createSignServer({
  ...base,
  workspaceMail: async (workspaceId) => {
    const brand = await brandOf(workspaceId);
    return {
      fromName: brand.name,
      ...(brand.replyTo ? { replyTo: brand.replyTo } : {}),
      templates: {
        invite: (ctx) => {
          const mail = defaultTemplates.invite(ctx);
          return { ...mail, subject: `${brand.name}: ${mail.subject}` };
        },
      },
    };
  },
});
```

`workspaceTimeZone(workspaceId)` returns a workspace's own IANA time zone, or null to use
`timeZone`. It is read when an envelope is sealed (dates on the document, local time on the
certificate), when a signer opens their link (the view's `timeZone` field) and when an
invitation or reminder is written (the expiry, which templates get as `ctx.timeZone`; format
it with `formatMailDate`).

`certificateNote(workspaceId)` returns a short line printed at the end of the signing
certificate of that workspace's envelopes, for example a company registration number. It is
read when the envelope is sealed.

`certificateDetails({ workspaceId, envelope })` returns
`{ sender?: { name, organization?, email? }, recordUrl? }` for the certificate: who sent the
envelope, and a link to a page of yours that shows its record, printed as a QR code and as
text. It is called once when a completed envelope is sealed, so it can create the record
then. Without it the certificate names no sender and carries no code.

## Errors

Every error is JSON: `{ "error": { "code", "message", "details"? } }`. Codes are the
`SignError` codes from core plus `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT` and `INTERNAL`.
Validation errors list each problem in `details.issues` as `{ path, message }`, for example
`recipients[1].email`. Stack traces never leave the server.

## Webhooks

Each delivery is a POST with the event, envelope id, status and recipients, signed as
`x-codevibe-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. Check it
with `verifyWebhook(secret, header, rawBody)`. Failed deliveries are retried from an outbox
with backoff (30 s up to 12 h, nine attempts in all).

Target URLs are checked when the server starts and again before every delivery: `https`
only, no credentials, no privileged port other than 443, no bare IP address. The host is
resolved and refused if any address is loopback, private, link-local (`169.254.0.0/16`,
cloud metadata), CGNAT, multicast or reserved, including the IPv6 forms; the request then
goes to the address that was checked, with a 5 s connect and 10 s total timeout, no
redirects, and at most 64 KB of the answer read. `checkWebhookUrl` and `isPublicAddress` are
exported for checking URLs when integrators register them.

`webhookSecurity` adjusts this:

- `allowHosts: ['hooks.example.com', '.internal.example.com']`: only these hosts (a leading
  dot matches subdomains), trusted wherever they resolve;
- `allowInsecure: true`: also `http://`, IP hosts and private addresses, for a receiver on
  your machine during development;
- `lookup`: your own resolver.

If you pass `fetch`, deliveries use it; the URL and addresses are still checked, but the
connection cannot be pinned to the checked address.

### Delivery log, tests and redelivery

`onWebhookDelivery(report)` is called after every attempt with the delivery id, workspace,
URL, event, the exact body, the attempt number, the outcome (`delivered`, `failed`, or
`skipped` when the target was removed or turned off), the receiver's status, the error and
when it will be retried. Keep the reports to show people a delivery log; a hook that throws
is logged and does not affect the delivery.

<!-- check:
import type { SignServer } from '@codevibe_technology/sign-server';
declare const sign: SignServer;
-->

```ts check
const test = await sign.sendTestWebhook({
  workspaceId: 'ws_1',
  url: 'https://hooks.example.com/sign',
});
// test.outcome: 'delivered' | 'failed' | 'skipped'; test.status: the receiver's answer

await sign.redeliverWebhook({
  workspaceId: 'ws_1',
  url: 'https://hooks.example.com/sign',
  deliveryId: test.deliveryId,
  body: test.body,
});
```

`sendTestWebhook` posts a signed `webhook.test` event (no envelope) to one of the
workspace's targets; `redeliverWebhook` posts an earlier body again under the same id. Both
deliver once, now, and are never queued for retry.

## Envelope changes and sent mail

`onEnvelopeChange({ workspaceId, envelopeId, actions })` is called once each change is
saved, with the audit actions it recorded (`envelope.sent`, `recipient.viewed`,
`recipient.signed`, `envelope.completed`, `document.sealed`, `recipient.reminded`,
`envelope.expired` and the rest). Use it to tell open pages to refresh. A hook that throws
is logged and does not undo the change.

Every email the server sends carries `meta` (kind, workspace, envelope and recipient ids) so
a mailer can keep a send log without storing bodies, links or codes. `meta` is never sent.

When the sealed files of a completed envelope are over `limits.maxAttachmentBytes`, cannot be
read, or the provider refuses the message with them attached, the completed copy goes out
with a personal download link per document instead (`GET /v1/sign/copy/:docId?c=...`, valid
for 30 days, signed with `sessionSecret`).

## Background work

Invitations, reminders, completion copies, webhooks and sealing are jobs in the store.
They run right after the request (`effects: 'await'`, the default) or just after the
response (`'background'`), and `tick()` retries the ones that failed. Call `tick()` every
minute: it also sends due reminders, expires envelopes, gives up on Aadhaar eSign attempts
past their time (after asking the provider once more) and retries `onEnd` calls that failed.

## Adapters

- Stores: `memoryStore()`, `postgresStore(urlOrSql)` with `migrate(sql)`. Migrations are
  also exported as `migrations` for your own tooling. A custom `ServerStore` must make
  `issueOtp` and `updateOtp` atomic and refuse a second audit event with the same `seq`.
- Files: `localFileStore(dir)`, `memoryFileStore()`.
- Mail: `smtpMailer({ transport, from, messageIdDomain })`, `consoleMailer()`. The SMTP
  mailer sets a `Message-ID` on `messageIdDomain` (default: the sender address's domain) and
  returns it from `send`. `fromHeader(from, name)` builds the `From` header it sends.
- OTP: `mailOtpSender(mailer)`, `consoleOtpSender()`. Bring your own `OtpSender` for SMS.
- Rate limits: `memoryRateLimiter()`. Pass a shared `RateLimiter` when running more than
  one process, and set `sessionSecret` so sessions work across them.

## Logs

`logger` receives errors and warnings, and with `accessLog: true` one `info` line per request
(method, path, status, milliseconds). Everything is redacted before it reaches the logger:
the signing token segment becomes `:token`, query strings are dropped, bearer keys and
anything that looks like a signing token are replaced, and fields such as `authorization`,
`cookie`, `code`, `body` and `value` are removed.

## Licence

AGPL-3.0-only © Codevibe. You can use, self-host and change the server freely, including
inside your company. If you let other people use a modified version over a network, you offer
them your changes under the same licence. A commercial licence is available from
hello@codevibe.in. See
[LICENSING.md](https://github.com/codevibe-technology/codevibe-sign/blob/main/LICENSING.md).

Guides and the HTTP API reference are at
[sign.codevibe.in](https://sign.codevibe.in?utm_source=github&utm_medium=readme&utm_campaign=sign-server&utm_content=body).
