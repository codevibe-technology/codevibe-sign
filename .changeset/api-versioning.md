---
'@codevibe_technology/sign-server': minor
---

Every answer under `/v1` carries `Codevibe-Api-Version: 1`. An operation marked
`deprecated: true` in the OpenAPI document, with `x-deprecated-since` and `x-sunset` dates at
least six months apart, answers with `Deprecation` (RFC 9745), `Sunset` (RFC 8594) and a
`Link` with `rel="deprecation"`. Nothing is deprecated.
