---
'codevibe-sign': patch
'@codevibe_technology/sign-core': patch
'@codevibe_technology/sign-pdf': patch
'@codevibe_technology/sign-server': patch
'@codevibe_technology/sign-client': patch
'@codevibe_technology/sign-react': patch
'@codevibe_technology/sign-templates': patch
'@codevibe_technology/sign-aadhaar': patch
---

READMEs and notices say which licence each package carries: `npm i codevibe-sign` only ever
installs Apache-2.0 code, and `@codevibe_technology/sign-server` is AGPL-3.0-only with its own
`start` command. The `sign-aadhaar` README says clearly that it is a standalone library, not
yet wired into the server. The server README links to the licensing page by its full address,
so the link works on npm.
