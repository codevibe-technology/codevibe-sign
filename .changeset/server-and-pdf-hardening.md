---
'@codevibe_technology/sign-pdf': minor
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-core': minor
'@codevibe_technology/sign-client': patch
---

PDF:

- Add `verify(bytes, { trust, limits? })`: valid only when the file has exactly one signature,
  it is intact, covers every byte, and was made with a trusted certificate (fingerprint,
  certificate or a root it chains to). `verifySeal` stays as the low-level check.
- `verifySeal` locates the signature through the form's `/Sig` field instead of the first
  `/ByteRange` text in the file.
- `inspectPdf` and `verify` read files in a worker thread under limits (500 pages, 100 000
  objects, depth 64, 50 MB decoded streams, 10 s), all configurable; `checkParseLimits` and
  `DEFAULT_PARSE_LIMITS` are exported.
- `renderFields` draws on a fresh copy of the pages without scripts, actions, embedded files,
  XFA or other active content, with forms flattened; `sanitizePdf` does that alone.
  Signature images are re-encoded under limits before they are embedded.
- `seal` refuses RSA keys under 2048 bits and certificates signed with SHA-1 or MD5 unless
  `allowWeakKey` is set, and certificates not yet valid. `sealCertificate` returns the
  operator certificate and its fingerprint with the same checks.

Server:

- Signing links open `GET /sign/:token`, which stores the token in an HttpOnly,
  SameSite=Strict cookie and redirects to `signingPageUrl`; pages use `/v1/sign/link/...`.
  Opening a link never changes state.
- Malformed tokens are refused before hashing, rate-limit keys or lookups.
- OTP: at most `limits.otpCodesPerRecipient` (10) codes per recipient per envelope; checks are
  saved with a compare-and-set so parallel guesses all count. Migration `0002_otp_issuance`.
  `ServerStore` gains `issueOtp` and `updateOtp` in place of `putOtp`, and `commit` needs an
  expected version.
- Client IPs behind proxies come from the right of `X-Forwarded-For` (`trustedProxyHops`,
  default 1).
- API keys are kept as SHA-256 hashes; `{ id, sha256 }` entries are accepted.
- Webhook URLs must be https on a public host; each delivery checks the resolved addresses and
  connects to the checked one, without redirects and with a 64 KB response cap.
  `webhookSecurity` has `allowHosts`, `allowInsecure` (development only) and `lookup`.
- Every log line is redacted; `accessLog: true` adds one line per request.
- The seal key is checked at start-up (`sealer.allowWeakKey` for development), sealed files
  are verified before they are stored, and
  `GET /v1/envelopes/:id/documents/:docId/verification` reports `verify()` for a document.
- Audit chains are checked with the envelope id; draft updates retry once on a version
  conflict.

Core: export `isSigningTokenShape`.

Client: document `token: 'link'` for pages opened through the server's link redirect.
