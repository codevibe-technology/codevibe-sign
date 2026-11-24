# @codevibe_technology/sign-client

## 0.1.0

### Minor Changes

- abcdbba: Public verification of sealed PDFs: `POST /v1/verify` (upload) and `GET /v1/verify/{sha256}`
  say whether a file is exactly what the server sealed, which check failed, and for a valid
  file the envelope, signers and audit chain head its certificate page prints. No API key;
  limited per client address (`limits.verifyPer10Minutes`), in size and in files checked at
  once. `server.verifyPdf(bytes)` gives the same answer in process. The client gains
  `verify.pdf`, `verify.sha256` and `createVerifyClient` for callers without a key.
- abcdbba: Templates in the HTTP API: `GET`, `POST`, `PATCH` and `DELETE /v1/templates`, and
  `POST /v1/templates/{templateId}/envelopes` to make an envelope by naming a person for each
  role, with `prefill` for text fields. Templates belong to the workspace of the API key and
  live in the store (`sign_templates`, migration `0004_templates_and_sealed_lookup`); pass
  `templateStore` to keep them elsewhere. The client gains `templates.list`, `create`, `get`,
  `update`, `delete` and `createEnvelope`.
- 3ddda61: The eight packages now share one version number and are released together, starting at 0.1.0.
  Releases are published from GitHub Actions through npm trusted publishing, so each one carries
  a provenance statement. The README shown on npm tags its links to the docs with the npm source.
- f6e8c50: **Breaking, before 1.0:** envelope and document JSON from the HTTP API no longer carries
  `fileKey`, the path the server's file store keeps each original under. It was never an input
  and gave callers nothing they could use; download a document through
  `GET /v1/envelopes/:id/documents/:docId`. The OpenAPI document, the Postman collection and the
  client's `Envelope` and `Document` types follow. Webhook payloads never had it. The server
  exports `ApiEnvelope` and `ApiDocument` for the shape it answers with; core's own `Document`
  type, used in-process, still has `fileKey`.
- 349e312: Node 22 is the minimum (`engines.node` is `>=22`). Node 20 has reached end of life and is no
  longer tested; CI runs on Node 22 and 24.
- f6e8c50: Server: new `workspaceTimeZone(workspaceId)` option. It names a workspace's own IANA time zone
  for the dates printed on its signed documents and the local time on the certificate page;
  `timeZone` stays the default for workspaces that return null. The signer view
  (`GET /v1/sign/:token`) has a new `timeZone` field, the zone the signing date will be printed
  in. Invitation and reminder emails give the expiry as a date and time with the zone named
  (`30 Nov 2026, 23:59 GMT+5:30`) instead of a UTC date; templates receive `timeZone` in their
  context, and `formatMailDate` is exported for custom templates.
  
  Client: `SigningSession` has the new `timeZone` field.
  
  Core: `currentRecipients` and `isActive` accept any object with the envelope fields they
  read.

### Patch Changes

- 349e312: CommonJS projects get correct types. Every entry point's `exports` now names a declaration
  file per format (`.d.ts` for `import`, `.d.cts` for `require`), so `require('codevibe-sign')`
  and the scoped packages type-check under `moduleResolution: node16` instead of being read as
  ES modules. `./package.json` is exported from every package.
- 01a8a00: READMEs and notices say which licence each package carries: `npm i codevibe-sign` only ever
  installs Apache-2.0 code, and `@codevibe_technology/sign-server` is AGPL-3.0-only with its own
  `start` command. The `sign-aadhaar` README says clearly that it is a standalone library, not
  yet wired into the server. The server README links to the licensing page by its full address,
  so the link works on npm.
- f4f7ad1: Refuse PDFs that already carry digital signatures instead of silently removing them.
  
  - Core: new error code `PDF_ALREADY_SIGNED`.
  - PDF: `inspectPdf` throws `PDF_ALREADY_SIGNED` (with `details.signatureCount`) for a file with
    signed `/Sig` fields, with the message "This PDF already carries digital signatures. Signing
    it again here would remove them. Upload the unsigned original." (`ALREADY_SIGNED_MESSAGE`).
    `seal` refuses such a file too (`details.step: 'seal'`), since it rewrites the whole file.
  - Server: envelope uploads and document replacements answer 422 `PDF_ALREADY_SIGNED`; the
    OpenAPI document lists the code.
  - Client: `SignApiError.code` can be `PDF_ALREADY_SIGNED`.
  - CLI: `codevibe-sign inspect` reports an already signed file as not usable (`problem:
  already_signed`, exit code 1).
- 5a1cdd0: The README banners are redrawn in one style with each package's current description, the
  badges use the brand navy, and the `sign-aadhaar` README shows how Aadhaar eSign works in the app.
- 51a4887: Server: until a recipient who signs with a one-time code has entered it, `GET /v1/sign/:token`
  returns no message, documents, fields or values and masks the email address; read it again
  after `otp/verify`. New `timeZone` option (`TIME_ZONE` for the standalone server) for the dates
  printed on signed documents and the local time on the certificate page. Downloads keep
  document names in other scripts through `filename*`. IPv4-translated addresses are refused as
  webhook targets. Updates hono and @hono/node-server for security advisories.
  
  React: the page scroll area of the signing view and the field placer can be reached and
  scrolled from the keyboard.
  
  Client: `SigningSession` documents that `documents`, `fields` and `values` are empty until the
  one-time code has been checked; call `session()` again after `verifyOtp`.
- 260ba1c: PDF:
  
  - Add `verify(bytes, { trust, limits? })`: valid only when the file has exactly one signature,
    it is intact, covers every byte, and was made with a trusted certificate (fingerprint,
    certificate or a root it chains to). `verifySeal` stays as the low-level check.
  - `verifySeal` locates the signature through the form's `/Sig` field instead of the first
    `/ByteRange` text in the file.
  - `inspectPdf` and `verify` read files in a worker thread under limits (500 pages, 100 000
    objects, depth 64, 50 MB decoded streams, 10 s), all configurable; `checkParseLimits` and
    `DEFAULT_PARSE_LIMITS` are exported.
  - `renderFields` draws on a fresh copy of the pages without scripts, actions, embedded files,
    XFA or other active content, with forms flattened; `sanitizePdf` does that alone.
    Signature images are re-encoded under limits before they are embedded.
  - `seal` refuses RSA keys under 2048 bits and certificates signed with SHA-1 or MD5 unless
    `allowWeakKey` is set, and certificates not yet valid. `sealCertificate` returns the
    operator certificate and its fingerprint with the same checks.
  
  Server:
  
  - Signing links open `GET /sign/:token`, which stores the token in an HttpOnly,
    SameSite=Strict cookie and redirects to `signingPageUrl`; pages use `/v1/sign/link/...`.
    Opening a link never changes state.
  - Malformed tokens are refused before hashing, rate-limit keys or lookups.
  - OTP: at most `limits.otpCodesPerRecipient` (10) codes per recipient per envelope; checks are
    saved with a compare-and-set so parallel guesses all count. Migration `0002_otp_issuance`.
    `ServerStore` gains `issueOtp` and `updateOtp` in place of `putOtp`, and `commit` needs an
    expected version.
  - Client IPs behind proxies come from the right of `X-Forwarded-For` (`trustedProxyHops`,
    default 1).
  - API keys are kept as SHA-256 hashes; `{ id, sha256 }` entries are accepted.
  - Webhook URLs must be https on a public host; each delivery checks the resolved addresses and
    connects to the checked one, without redirects and with a 64 KB response cap.
    `webhookSecurity` has `allowHosts`, `allowInsecure` (development only) and `lookup`.
  - Every log line is redacted; `accessLog: true` adds one line per request.
  - The seal key is checked at start-up (`sealer.allowWeakKey` for development), sealed files
    are verified before they are stored, and
    `GET /v1/envelopes/:id/documents/:docId/verification` reports `verify()` for a document.
  - Audit chains are checked with the envelope id; draft updates retry once on a version
    conflict.
  
  Core: export `isSigningTokenShape`.
  
  Client: document `token: 'link'` for pages opened through the server's link redirect.
- ce8677b: Mail messages can carry a `fromName` and `replyTo`, and `smtpMailer` sends them while
  keeping its own address. The new `workspaceMail` option gives each workspace its own
  templates and sender details. A signing link that no longer works redirects with `?state=`
  saying why, the signer view names its `workspaceId`, and a successful submit hands back a
  receipt for `GET /v1/sign/receipt`, from which the signer can download the sealed copy.
- 0074faf: Envelopes now belong to a workspace. API keys take an optional `workspaceId`, the new
  `authenticate` and `webhookTargets` options resolve callers and webhooks per workspace,
  `GET /v1/envelopes` lists the caller's envelopes and `basePath` mounts the server under a
  prefix. Existing single-tenant setups keep working; migration `0003_workspaces` adds the
  column. The client knows the new `FORBIDDEN` error code.
