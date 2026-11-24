# @codevibe_technology/sign-templates

## 0.1.0

### Minor Changes

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
