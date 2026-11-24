# @codevibe_technology/sign-react

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

- 3ddda61: The eight packages now share one version number and are released together, starting at 0.1.0.
  Releases are published from GitHub Actions through npm trusted publishing, so each one carries
  a provenance statement. The README shown on npm tags its links to the docs with the npm source.
- 349e312: Node 22 is the minimum (`engines.node` is `>=22`). Node 20 has reached end of life and is no
  longer tested; CI runs on Node 22 and 24.
- 163cb3d: `FieldPlacer` is redrawn: a grouped field tray with Email, Company and Title fields, a page
  rail, undo and redo, copy and paste, several fields selected at once, corner resize handles,
  alignment guides, a per-signer summary and a signer preview. `SigningView` can confirm before
  finishing (`confirmBeforeFinish`) and offers ready-made decline reasons.
- c8b0006: `FieldPlacer` marks signature and initials fields that cover page text with an "Over text"
  badge and a note in the side panel. The check is a warning only. `coveredText` and
  `fieldsOverText` are exported for custom editors.
- 545fc51: The signing view guides the signer: one button reads Start, then Next, and Sign or Initial
  on a signature box, and Finish becomes the main button when nothing is left. It moves on by
  itself after a signature, marks the current field with a flag, and shows progress as a bar.
  Given a height, the pages scroll inside the view in both directions with the action bar
  pinned under them; zoomed in, a vertical scroll is no longer swallowed and the page's left
  edge can be reached. Empty signature boxes are shown at a size a finger can hit, a
  signature saved on an earlier visit is adopted, and redoing a signature replaces it in
  every box that used it. New labels: `start`, `next`, `guideFlag`, `documentRegion`,
  `actions`, `reuseSignature`, `reuseInitials`.
  
  In the field placer a field starts on "This page only". "Show on pages" offers this page,
  all pages or specific pages and applies as it is picked; the choices "every page except the
  first" and "last page" and the separate Repeat button are gone, so `RepeatChoice` is now
  `'this' | 'all' | 'custom'` and the label `repeated` is replaced by `repeatChanged`, with
  `pagesLabel` and `pagesHint` added. A field added by a click lands in the part of the page
  on screen, clear of the fields already there, and the drag ghost is the size of the field.
  `useFieldPlacement` gains `setFieldPages` and `pagesOf`; `formatPageList`, `choiceForPages`
  and `freeRect` are exported.

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
