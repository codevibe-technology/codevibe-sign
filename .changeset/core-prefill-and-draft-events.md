---
'@codevibe/sign-core': minor
'@codevibe/sign-templates': minor
---

Core:

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
