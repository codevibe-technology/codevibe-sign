---
'@codevibe_technology/sign-core': minor
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-client': patch
---

Mail messages can carry a `fromName` and `replyTo`, and `smtpMailer` sends them while
keeping its own address. The new `workspaceMail` option gives each workspace its own
templates and sender details. A signing link that no longer works redirects with `?state=`
saying why, the signer view names its `workspaceId`, and a successful submit hands back a
receipt for `GET /v1/sign/receipt`, from which the signer can download the sealed copy.
