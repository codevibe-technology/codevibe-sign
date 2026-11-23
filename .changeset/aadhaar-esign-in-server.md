---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-core': minor
'@codevibe_technology/sign-aadhaar': minor
'@codevibe_technology/sign-pdf': minor
---

Aadhaar eSign is built into the server. Pass `esign` to `createSignServer` with a provider
from `@codevibe_technology/sign-aadhaar` and a recipient with `auth: 'aadhaar'` signs at the
provider: `POST /v1/sign/{token}/esign` starts it, `GET /v1/sign/{token}/esign` follows it,
and `POST /v1/esign/webhooks/{provider}` takes the provider's callback, verified with the
credentials of the workspace that started the request. `onStart` and `onEnd` hooks let you
reserve and settle what an eSign costs. The provider's file is never rewritten: the seal is
added after it, the signing certificate becomes a sealed file of its own
(`?version=certificate`), and verification answers gain `seal` and `earlierSignatures`. New
error code `ESIGN_UNAVAILABLE` (409). Needs migration `0005_esign_sessions`, which the
server applies itself; a database role with narrowed grants also needs
`select, insert, update` on `sign_esign_sessions`.

Core adds the rules for such an envelope (one Aadhaar signer, one document, signing last),
`Recipient.esign`, the audit actions `recipient.esign_started` and `recipient.esign_failed`,
and optional `data` on `submit` and `recordSeal`. The Aadhaar package adds
`EsignRequest.reference`, `EsignProvider.webhookRef` and `checkCredentials`, and
`leegalityWebhookRef`. The PDF package prints "Aadhaar eSign (via Leegality)" on the
certificate and exports `authLabel`.
