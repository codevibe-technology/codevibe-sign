# @codevibe_technology/sign-aadhaar

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
- Updated dependencies [7dbd02e]
  - @codevibe_technology/sign-core@0.1.1

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
- 3ddda61: The eight packages now share one version number and are released together, starting at 0.1.0.
  Releases are published from GitHub Actions through npm trusted publishing, so each one carries
  a provenance statement. The README shown on npm tags its links to the docs with the npm source.
- 349e312: Node 22 is the minimum (`engines.node` is `>=22`). Node 20 has reached end of life and is no
  longer tested; CI runs on Node 22 and 24.

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
