---
title: Sealing and verification
description: How the final PDF is produced, what the certificate page contains, what the PAdES seal proves and how anyone can verify it.
---

# Sealing and verification

When the last required action is done, the envelope is completed and a `seal` effect is
emitted. The server then produces one final file.

## Steps

1. **Draw** every field value onto the original pages.
2. **Append a certificate page** with the envelope id, the SHA-256 of each document before and
   after signing, each recipient (name, email or phone, authentication used, IP, user agent and
   the time of each action) and the audit chain head hash.
3. **Seal** the file with a PAdES-B detached signature made with the operator's certificate.
4. **Record** the sealed file's hash in the audit log (`document.sealed`).

## What the seal proves

The seal is made with **your** certificate as the operator, not with the signer's. It proves
that the file has not changed since it was sealed. Any later edit, even one character, makes the
seal invalid in Adobe Reader and in `verify()`.

Who agreed, and when, is proven by the audit trail on the certificate page and in the chain.
For a signature tied to the signer's own identity under Indian law, use
[Aadhaar eSign](/guides/aadhaar-leegality).

## Your sealing certificate

You need a certificate and private key as a PKCS#12 (`.p12`) file.

- For development, a self-signed certificate is fine.
- For files other people will open, use a certificate from an issuer that Adobe Reader trusts.
  Otherwise Reader shows the seal as intact but the signer identity as unknown.
- Treat the key like a password. Anyone who has it can seal files in your name.

## Verifying a file

Anyone with the sealed PDF can check it without contacting your server:

- open it in Adobe Reader and look at the signature panel; or
- call `verify()` from `@codevibe_technology/sign-pdf`, which checks the seal and reads the certificate
  page.

See [Verify a sealed PDF](/guides/verify-pdf).
