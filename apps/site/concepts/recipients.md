---
title: Recipients
description: Signers, approvers and viewers, their signing order, how they authenticate and the statuses they move through.
---

# Recipients

Each recipient has a name, an email address or phone number, a role, an order and an
authentication method.

## Roles

| Role       | What they do                                                         |
| ---------- | -------------------------------------------------------------------- |
| `signer`   | Fills their fields and signs. Needs at least one signature field.    |
| `approver` | Reviews and approves. Can have fields, but no signature is required. |
| `viewer`   | Receives the completed copy. Never acts and has no fields.           |

## Order

`order` is used in [sequential routing](./routing): the lowest unfinished order acts first, and
recipients with the same order act together. If you leave it out, a new signer or approver gets
the next order after the highest one so far.

## Authentication

| Method       | How the recipient proves it is them                                                   |
| ------------ | ------------------------------------------------------------------------------------- |
| `email_otp`  | The link, plus a six-digit code sent by email. The default.                           |
| `email_link` | Opening the private signing link sent to their email.                                 |
| `sms_otp`    | The link, plus a six-digit code sent by SMS. Default when only a phone is given.      |
| `aadhaar`    | Aadhaar eSign on the provider's page. See [Aadhaar eSign](/guides/aadhaar-leegality). |

The method used is recorded in the audit log and printed on the certificate page.

`aadhaar` has rules of its own, checked when the envelope is sent: one recipient may use it,
they must be a signer, the envelope holds one document, and they act last. The certificate
names the provider, for example "Aadhaar eSign (via Leegality)".

`email_link` proves only that someone could open the recipient's inbox, so a forwarded link is
enough to sign. A one-time code is stronger evidence, so it is the default everywhere: the web
app, the HTTP API, templates and the core builder all start a recipient with an email address on
`email_otp`. Pass `auth: 'email_link'` when the link alone is enough for a document.

## Status

```
pending → notified → viewed → signed | approved | declined
```

- **pending**: not yet invited, usually waiting for an earlier order.
- **notified**: invited; reminders count from here.
- **viewed**: opened the document.
- **signed**, **approved**: done.
- **declined**: refused, with a reason. This stops the envelope for everyone.
