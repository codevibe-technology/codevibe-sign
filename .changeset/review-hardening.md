---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-react': patch
'@codevibe_technology/sign-client': patch
'codevibe-sign': minor
---

Server: until a recipient who signs with a one-time code has entered it, `GET /v1/sign/:token`
returns no message, documents, fields or values and masks the email address; read it again
after `otp/verify`. New `timeZone` option (`TIME_ZONE` for the standalone server) for the dates
printed on signed documents and the local time on the certificate page. Downloads keep
document names in other scripts through `filename*`. IPv4-translated addresses are refused as
webhook targets. Updates hono and @hono/node-server for security advisories.

React: the page scroll area of the signing view and the field placer can be reached and
scrolled from the keyboard.

Client: `SigningSession` documents that `documents`, `fields` and `values` are empty until the
one-time code has been checked; call `session()` again after `verifyOtp`.
