---
title: Sealing and verification
description: How the final PDF is produced, what the certificate page contains, what the PAdES seal proves and how anyone can verify it.
---

# Sealing and verification

When the last required action is done, the envelope is completed and a `seal` effect is
emitted. The server then produces one final file.

## Steps

1. **Draw** every field value onto the original pages.
2. **Append a certificate page**: the document title, envelope id, status and completion time,
   the sender, each recipient (name, masked email or phone, authentication used and the time
   they signed), the document's SHA-256, the audit chain head hash and a QR code that opens the
   record of the signing. IP addresses and browser details stay in the audit log.
3. **Seal** the file with a PAdES-B detached signature made with the operator's certificate.
4. **Record** the sealed file's hash in the audit log (`document.sealed`).

## What the seal proves

The seal is made with **your** certificate as the operator, not with the signer's. It proves
that the file has not changed since it was sealed. Any later edit, even one character, makes the
seal invalid in every check: the verify page, `verify()` and PDF readers that check signatures.

Who agreed, and when, is proven by the certificate page and the audit trail behind it.
For a signature tied to the signer's own identity under Indian law, use
[Aadhaar eSign](/guides/aadhaar-leegality).

## Your sealing certificate

You need a certificate and private key as a PKCS#12 (`.p12`) file.

- For development, a self-signed certificate is fine.
- Any certificate proves the file is unchanged. To have PDF readers also name you as the
  sealer on their own, use a document-signing certificate from a certificate authority; see
  [How the seal works in PDF readers](/guides/seal-in-pdf-readers).
- Treat the key like a password. Anyone who has it can seal files in your name.

## Verifying a file

Anyone with the sealed PDF can check it without contacting your server:

- scan the QR code on the certificate page, or drop the file on the verify page; or
- call `verify()` from `@codevibe_technology/sign-pdf`, which checks the seal offline.

See [Verify a sealed PDF](/guides/verify-pdf).
