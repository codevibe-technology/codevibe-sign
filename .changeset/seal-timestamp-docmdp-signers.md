---
'@codevibe_technology/sign-pdf': minor
'@codevibe_technology/sign-server': minor
---

Stronger seals.

PDF:

- `seal` takes `tsaUrl` (with `tsaRequired`, default true, `tsaTimeoutMs` and
  `onTimestampFailure`) and adds an RFC 3161 signature timestamp, making the seal PAdES B-T.
  The authority's answer must be granted, echo the nonce and SHA-256 imprint, and carry a
  valid authority signature. `verifySeal` reports the time as `timestampedAt`.
- The seal is a certification signature with DocMDP P=1 (no changes allowed) when it is the
  first signature in the file; `certify: false` makes an approval signature.
- A seal certificate issued by a private root (or a CA) is supported: the issuers in the
  `.p12` are checked and embedded in the signature, unrelated certificates are left out. A
  CA-issued seal certificate must be CA:FALSE, and key usage and extended key usage, when
  present, must allow document signing. A single self-signed certificate keeps working.
- Signing goes through a `SealProvider` (`certificateChain()`, `sign(data)`): `p12Signer` is
  the default, `signer` takes your own, and `pkcs11Signer` and `cscSigner` are typed
  placeholders that fail with "not configured".
- No longer depends on `@signpdf/placeholder-pdf-lib`.

Server: `sealer.tsaUrl` and `sealer.tsaRequired`, and the `SEAL_TSA_URL` and
`SEAL_TSA_REQUIRED` variables for the standalone server. A skipped optional timestamp is
logged as a warning.
