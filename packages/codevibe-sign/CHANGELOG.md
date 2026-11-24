# codevibe-sign

## 0.1.1

### Patch Changes

- Updated dependencies [7dbd02e]
  - @codevibe_technology/sign-core@0.1.1
  - @codevibe_technology/sign-pdf@0.1.1
  - @codevibe_technology/sign-client@0.1.1

## 0.1.0

### Minor Changes

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
- 9fd40bd: New `codevibe-sign` package: the client, PDF tools, core rules and React components behind one
  Apache-2.0 install with subpath imports, and a `codevibe-sign` CLI (`verify`, `inspect`,
  `keygen`, `hash`, `api-key`).
  
  Server: `configFromEnv()` reads the standalone service's environment variables, the same ones
  the Docker image uses.
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
- Updated dependencies [ac5f22b]
- Updated dependencies [1efd881]
- Updated dependencies [abcdbba]
- Updated dependencies [abcdbba]
- Updated dependencies [8ab5053]
- Updated dependencies [4483236]
- Updated dependencies [78f4c22]
- Updated dependencies [5a1204d]
- Updated dependencies [349e312]
- Updated dependencies [1fbe1e4]
- Updated dependencies [d3ad9b8]
- Updated dependencies [5833ba0]
- Updated dependencies [4fc0b2f]
- Updated dependencies [287722a]
- Updated dependencies [3ddda61]
- Updated dependencies [01a8a00]
- Updated dependencies [f6e8c50]
- Updated dependencies [349e312]
- Updated dependencies [f4f7ad1]
- Updated dependencies [5a1cdd0]
- Updated dependencies [51a4887]
- Updated dependencies [eeb8793]
- Updated dependencies [260ba1c]
- Updated dependencies [ce8677b]
- Updated dependencies [0074faf]
- Updated dependencies [247c5be]
- Updated dependencies [f6e8c50]
  - @codevibe_technology/sign-core@0.1.0
  - @codevibe_technology/sign-pdf@0.1.0
  - @codevibe_technology/sign-client@0.1.0
