---
'@codevibe_technology/sign-core': minor
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-templates': minor
---

**Breaking, before 1.0:** a recipient with an email address now signs with `email_otp` unless
you say otherwise: the signing link plus a six-digit code sent by email. `addRecipient` in core,
`POST /v1/envelopes` and `PATCH /v1/envelopes/:id` on the server, and template roles without an
`auth` all follow. A link alone proves only that someone could open the inbox, so a forwarded
link was enough to sign. Pass `auth: 'email_link'` to keep the old behaviour for a recipient.
Recipients with only a phone number still default to `sms_otp`.
