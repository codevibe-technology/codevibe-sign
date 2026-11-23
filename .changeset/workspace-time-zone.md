---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-client': minor
'@codevibe_technology/sign-core': patch
'codevibe-sign': minor
---

Server: new `workspaceTimeZone(workspaceId)` option. It names a workspace's own IANA time zone
for the dates printed on its signed documents and the local time on the certificate page;
`timeZone` stays the default for workspaces that return null. The signer view
(`GET /v1/sign/:token`) has a new `timeZone` field, the zone the signing date will be printed
in. Invitation and reminder emails give the expiry as a date and time with the zone named
(`30 Nov 2026, 23:59 GMT+5:30`) instead of a UTC date; templates receive `timeZone` in their
context, and `formatMailDate` is exported for custom templates.

Client: `SigningSession` has the new `timeZone` field.

Core: `currentRecipients` and `isActive` accept any object with the envelope fields they
read.
