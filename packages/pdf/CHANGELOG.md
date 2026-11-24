# @codevibe_technology/sign-pdf

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
- 1efd881: **Breaking, before 1.0:** `codevibe-sign` is Apache-2.0 from end to end and no longer contains
  or depends on the AGPL server. The `codevibe-sign/server` export, the server names on the
  package root (`createSignServer`, `startSignServer`, `configFromEnv`, the stores and mailers)
  and the `codevibe-sign start` command are gone. Import the server from
  `@codevibe_technology/sign-server`, and run it with the Docker image or with its new command:
  
  ```sh
  npx @codevibe_technology/sign-server start --memory
  npx @codevibe_technology/sign-server start
  ```
  
  Server: new `codevibe-sign-server` command with `start` and `start --memory`, taking the same
  flags and environment variables as before.
  
  PDF: `createDevSeal()` moves here from `codevibe-sign`, which still re-exports it, so the
  server's memory mode and the `keygen` command share one Apache-2.0 implementation.
- 4483236: `appendCertificate` prints an optional `note` at the end of the certificate, and the server's
  `certificateNote` option supplies one per workspace when an envelope is sealed.
- 78f4c22: The signing certificate no longer prints the record address as text: the QR code carries it,
  and is a link in PDF readers. Under the code the page says who provided the certificate,
  with the Codevibe Sign logo drawn as vector paths. Files sealed earlier verify as before.
- 1fbe1e4: The signing certificate is one compact page: document, envelope id, status and completion
  time, sender, each signer with masked contact, method and signing time, the document
  fingerprint and, with `recordUrl`, a QR code and link to a record page. IP addresses, browser
  details and the event list are no longer printed in the file. `certificatePdf` makes the
  certificate a file of its own and `auditTrailPdf` the audit trail. The server's
  `certificateDetails` option supplies the sender and the record link when an envelope is
  sealed. Files sealed earlier keep their pages and verify as before.
- 5833ba0: `countersign` seals a PDF that already carries digital signatures, such as an Aadhaar eSign
  from an eSign provider, by appending an incremental update: the existing bytes and
  signatures stay as they are and the operator's seal covers them. `verifySignatures` lists
  every signature of a file with whether it is intact, and reads RSA (PKCS#1 v1.5 and PSS) and
  ECDSA signatures from other products. `verify` takes `allowEarlierSignatures` to accept a
  countersigned file, reports the earlier signatures and fails with
  `earlier_signature_invalid` when one of them is broken.
- 287722a: Aadhaar eSign: a request the signer replaces keeps its reservation until it runs out, a replaced
  recipient's requests are cancelled, the provider's file must end with a signature that verifies
  (`acceptUnreadableSignatures` relaxes the last part), and each request keeps its own file.
  `verify()` with `allowEarlierSignatures` reports `content_between_signatures` when anything but
  the seal follows the last earlier signature. A signature made in a provider's test environment
  is marked `sandbox` and labelled as such. The Leegality adapter no longer follows redirects.
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
- eeb8793: Stronger seals.
  
  PDF:
  
  - `seal` takes `tsaUrl` (with `tsaRequired`, default true, `tsaTimeoutMs` and
    `onTimestampFailure`) and adds an RFC 3161 signature timestamp, making the seal PAdES B-T.
    The authority's answer must be granted, echo the nonce and SHA-256 imprint, and carry a
    valid authority signature. `verifySeal` reports the time as `timestampedAt`.
  - The seal is a certification signature with DocMDP P=1 (no changes allowed) when it is the
    first signature in the file; `certify: false` makes an approval signature.
  - A seal certificate issued by a private root (or a CA) is supported: the issuers in the
    `.p12` are checked and embedded in the signature, unrelated certificates are left out. A
    CA-issued seal certificate must be CA:FALSE, and key usage and extended key usage, when
    present, must allow document signing. A single self-signed certificate keeps working.
  - Signing goes through a `SealProvider` (`certificateChain()`, `sign(data)`): `p12Signer` is
    the default, `signer` takes your own, and `pkcs11Signer` and `cscSigner` are typed
    placeholders that fail with "not configured".
  - No longer depends on `@signpdf/placeholder-pdf-lib`.
  
  Server: `sealer.tsaUrl` and `sealer.tsaRequired`, and the `SEAL_TSA_URL` and
  `SEAL_TSA_REQUIRED` variables for the standalone server. A skipped optional timestamp is
  logged as a warning.
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
- 247c5be: `renderFields` prints the signer's name and signing time in small type under each drawn
  signature. Set `signatureCaption: false` to leave it out.

### Patch Changes

- 8ab5053: Read signatures from other signers that use BER's indefinite length, as Leegality's Aadhaar eSign writes them. Seals must still be DER.
- 5a1204d: The Codevibe Sign logo on the signing certificate is now small and quiet: 12 points tall,
  centred under the QR code with its "provided by" line, instead of a wide logo past the code.
- 349e312: CommonJS projects get correct types. Every entry point's `exports` now names a declaration
  file per format (`.d.ts` for `import`, `.d.cts` for `require`), so `require('codevibe-sign')`
  and the scoped packages type-check under `moduleResolution: node16` instead of being read as
  ES modules. `./package.json` is exported from every package.
- 01a8a00: READMEs and notices say which licence each package carries: `npm i codevibe-sign` only ever
  installs Apache-2.0 code, and `@codevibe_technology/sign-server` is AGPL-3.0-only with its own
  `start` command. The `sign-aadhaar` README says clearly that it is a standalone library, not
  yet wired into the server. The server README links to the licensing page by its full address,
  so the link works on npm.
- 5a1cdd0: The README banners are redrawn in one style with each package's current description, the
  badges use the brand navy, and the `sign-aadhaar` README shows how Aadhaar eSign works in the app.
- Updated dependencies [ac5f22b]
- Updated dependencies [349e312]
- Updated dependencies [d3ad9b8]
- Updated dependencies [4fc0b2f]
- Updated dependencies [287722a]
- Updated dependencies [3ddda61]
- Updated dependencies [01a8a00]
- Updated dependencies [349e312]
- Updated dependencies [f4f7ad1]
- Updated dependencies [5a1cdd0]
- Updated dependencies [260ba1c]
- Updated dependencies [ce8677b]
- Updated dependencies [f6e8c50]
  - @codevibe_technology/sign-core@0.1.0
