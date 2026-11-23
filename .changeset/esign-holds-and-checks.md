---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-pdf': minor
'@codevibe_technology/sign-aadhaar': patch
'@codevibe_technology/sign-core': patch
---

Aadhaar eSign: a request the signer replaces keeps its reservation until it runs out, a replaced
recipient's requests are cancelled, the provider's file must end with a signature that verifies
(`acceptUnreadableSignatures` relaxes the last part), and each request keeps its own file.
`verify()` with `allowEarlierSignatures` reports `content_between_signatures` when anything but
the seal follows the last earlier signature. A signature made in a provider's test environment
is marked `sandbox` and labelled as such. The Leegality adapter no longer follows redirects.
