---
'@codevibe_technology/sign-pdf': minor
'@codevibe_technology/sign-server': minor
---

The signing certificate is one compact page: document, envelope id, status and completion
time, sender, each signer with masked contact, method and signing time, the document
fingerprint and, with `recordUrl`, a QR code and link to a record page. IP addresses, browser
details and the event list are no longer printed in the file. `certificatePdf` makes the
certificate a file of its own and `auditTrailPdf` the audit trail. The server's
`certificateDetails` option supplies the sender and the record link when an envelope is
sealed. Files sealed earlier keep their pages and verify as before.
