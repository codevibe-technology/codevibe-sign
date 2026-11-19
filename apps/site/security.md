---
title: Security
description: How Codevibe Sign protects signing links, one-time codes, files, webhooks and the audit trail, and how to report a vulnerability.
---

# Security

Codevibe Sign handles signed agreements and personal data. These are the rules every package
follows.

## Signing links

- Each link carries 32 random bytes, encoded as base64url.
- Only the SHA-256 of the token is stored.
- A token belongs to one envelope, expires and can be revoked.
- Tokens are compared in constant time, and anything not shaped like a token is refused before
  it is hashed.
- Opening a link moves the token into an HttpOnly, SameSite=Strict cookie and redirects to a page
  URL without it. Opening a link changes nothing, so mail scanners cannot mark a document as
  viewed.

## One-time codes

- Six digits, drawn uniformly, valid for 10 minutes.
- Locked after 5 wrong attempts, and rate limited per recipient and per IP address.
- At most 10 codes per recipient for one envelope; each new code replaces the last.
- Each check is saved atomically, so guesses sent in parallel all count.
- Stored only as a salted hash. A code that was accepted is never accepted again.

## Files

- Uploaded PDFs are size-capped and read first in a worker thread under limits on pages,
  objects, nesting, decompressed size and time; the worker is killed when a file goes over.
- Before fields are drawn, scripts, automatic actions, embedded files, external links and XFA
  are removed, forms are flattened and the pages are written into a fresh file.
- Signature images are size-capped and re-encoded to a clean PNG, under limits, before they
  are drawn.

## Audit trail and seal

- Every action is appended to a log chained with SHA-256. Changing or removing an event breaks
  the chain, and the head is printed in the sealed PDF.
- The final file carries a PAdES seal; any later edit makes it invalid. `verify()` also checks
  that the seal is the only signature, covers the whole file and was made with your
  certificate.
- The server refuses to start with a weak or expired sealing key.

## Webhooks

- Outbound webhooks are signed with HMAC-SHA256 over a timestamp and the body, and retried with
  backoff.
- They go only to `https` URLs on public addresses: the host is resolved and checked before each
  delivery, and the connection is made to the checked address, without following redirects.
- Inbound provider webhooks, such as Leegality's, are verified before they are trusted.

## Data

- Secrets are never logged: every server log line is redacted of tokens, codes, cookies,
  credentials and bodies. Errors never contain documents or credentials.
- API keys are kept only as SHA-256 hashes.
- The audit log holds only the personal data the certificate page needs.
- You run the service, so documents, keys and personal data stay in your infrastructure.

## Running it safely

- Serve it over TLS only.
- Keep the sealing key, API keys and the SMTP password in a secret store, not in the repository.
- Use long random API keys (at least 32 characters) and rotate them when people leave.
- Back up the database and the files together.

## Reporting a vulnerability

Email **security@codevibe.in**. Please do not open a public issue, pull request or discussion.

Include what you found, the affected package and version, steps to reproduce and the impact you
expect. You can expect an acknowledgement within 3 working days and an assessment and a plan
within 10 working days. Fixes are released with a security note in the changelog, and with
credit to you if you want it.

Until 1.0, only the latest minor release receives security fixes.
