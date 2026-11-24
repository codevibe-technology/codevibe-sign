# @codevibe_technology/sign-core

## 0.1.1

### Patch Changes

- 7dbd02e: An Aadhaar eSign signer may have one optional `aadhaar` field again, the Aadhaar seal
  position: it only says where the eSign provider draws its signature, takes no value and is
  never drawn. Core keeps it when signature and initials fields are dropped
  (`dropAadhaarSignatureFields`) and refuses a second one; `aadhaarSealPosition` returns it. The
  server passes it to the provider as `signaturePositions` with the page's crop box and rotation
  (`inspectPdf` in the PDF package now reports `boxes`). The placer offers it, with the quick add
  "Aadhaar seal on last page", only for that signer.
  
  The Leegality adapter places such positions through Leegality's 2.1 Create API by default
  (`positionApi: 'v2.1'`), with the same Auth Token: the request carries the signer's
  `appearances`, Aadhaar eSign by OTP, a version 2.5 webhook and the redirect URL, and is then
  followed like a v3.0 one. Requests without positions keep using v3.0. It also takes a `v4` workflow (`leegalityV4WorkflowFromPayload` reads one from the
  dashboard's downloaded API payload) and a `coordinates` mapping (default PDF points from the
  bottom-left). With `positionApi: 'v4'` a request with positions goes to the v4 Pack API with per-request
  coordinates and Webhook 4.0; its `providerRef` is `v4:<packId>:<documentId>`, and webhooks,
  status checks and downloads follow the v4 API.

## 0.1.0

### Minor Changes

- ac5f22b: Aadhaar eSign is built into the server. Pass `esign` to `createSignServer` with a provider
  from `@codevibe_technology/sign-aadhaar` and a recipient with `auth: 'aadhaar'` signs at the
  provider: `POST /v1/sign/{token}/esign` starts it, `GET /v1/sign/{token}/esign` follows it,
  and `POST /v1/esign/webhooks/{provider}` takes the provider's callback, verified with the
  credentials of the workspace that started the request. `onStart` and `onEnd` hooks let you
  reserve and settle what an eSign costs. The provider's file is never rewritten: the seal is
  added after it, the signing certificate becomes a sealed file of its own
  (`?version=certificate`), and verification answers gain `seal` and `earlierSignatures`. New
  error code `ESIGN_UNAVAILABLE` (409). Needs migration `0005_esign_sessions`, which the
  server applies itself; a database role with narrowed grants also needs
  `select, insert, update` on `sign_esign_sessions`.
  
  Core adds the rules for such an envelope (one Aadhaar signer, one document, signing last),
  `Recipient.esign`, the audit actions `recipient.esign_started` and `recipient.esign_failed`,
  and optional `data` on `submit` and `recordSeal`. The Aadhaar package adds
  `EsignRequest.reference`, `EsignProvider.webhookRef` and `checkCredentials`, and
  `leegalityWebhookRef`. The PDF package prints "Aadhaar eSign (via Leegality)" on the
  certificate and exports `authLabel`.
- d3ad9b8: Core:
  
  - Add `readOnly` to fields and `prefillFields` for values the sender fills in on a draft.
    `submit` counts prefilled values towards required fields and refuses changes to read-only
    fields with `FIELD_NOT_YOURS` (`details.readOnly: true`). `validateForSend` asks for a value
    on every required read-only field and checks stored draft values.
  - Export `rectIssues`, `pageSizeIssues`, `reminderIssues`, `validationError` and
    `PREFILLABLE_FIELD_TYPES`.
  - Add the `envelope.updated` audit action and `...WithEvents` variants of every draft edit
    (`addRecipientWithEvents`, `prefillFieldsWithEvents`, ...) that return a `TransitionResult`.
    The plain edits keep their return shapes.
  - `date_signed` fields always get the server's time of signing as a full ISO date-time in UTC;
    values sent by the signer are ignored.
  - `verifyChain` accepts `{ envelopeId }` to check that every event belongs to that envelope.
  
  Templates:
  
  - Reuse core's validators instead of local copies.
  - Lock read-only fields with core's `readOnly` flag; they stay required when the template says
    so. New envelopes no longer write `templateReadOnlyFields`, but `readOnlyFieldIds` and
    `assertWritable` still read it for envelopes created earlier.
- 4fc0b2f: **Breaking, before 1.0:** a recipient with an email address now signs with `email_otp` unless
  you say otherwise: the signing link plus a six-digit code sent by email. `addRecipient` in core,
  `POST /v1/envelopes` and `PATCH /v1/envelopes/:id` on the server, and template roles without an
  `auth` all follow. A link alone proves only that someone could open the inbox, so a forwarded
  link was enough to sign. Pass `auth: 'email_link'` to keep the old behaviour for a recipient.
  Recipients with only a phone number still default to `sms_otp`.
- 3ddda61: The eight packages now share one version number and are released together, starting at 0.1.0.
  Releases are published from GitHub Actions through npm trusted publishing, so each one carries
  a provenance statement. The README shown on npm tags its links to the docs with the npm source.
- 349e312: Node 22 is the minimum (`engines.node` is `>=22`). Node 20 has reached end of life and is no
  longer tested; CI runs on Node 22 and 24.
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

### Patch Changes

- 349e312: CommonJS projects get correct types. Every entry point's `exports` now names a declaration
  file per format (`.d.ts` for `import`, `.d.cts` for `require`), so `require('codevibe-sign')`
  and the scoped packages type-check under `moduleResolution: node16` instead of being read as
  ES modules. `./package.json` is exported from every package.
- 287722a: Aadhaar eSign: a request the signer replaces keeps its reservation until it runs out, a replaced
  recipient's requests are cancelled, the provider's file must end with a signature that verifies
  (`acceptUnreadableSignatures` relaxes the last part), and each request keeps its own file.
  `verify()` with `allowEarlierSignatures` reports `content_between_signatures` when anything but
  the seal follows the last earlier signature. A signature made in a provider's test environment
  is marked `sandbox` and labelled as such. The Leegality adapter no longer follows redirects.
- 01a8a00: READMEs and notices say which licence each package carries: `npm i codevibe-sign` only ever
  installs Apache-2.0 code, and `@codevibe_technology/sign-server` is AGPL-3.0-only with its own
  `start` command. The `sign-aadhaar` README says clearly that it is a standalone library, not
  yet wired into the server. The server README links to the licensing page by its full address,
  so the link works on npm.
- 5a1cdd0: The README banners are redrawn in one style with each package's current description, the
  badges use the brand navy, and the `sign-aadhaar` README shows how Aadhaar eSign works in the app.
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
