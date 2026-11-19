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
- Tokens are compared in constant time.

## One-time codes

- Six digits, drawn uniformly, valid for 10 minutes.
- Locked after 5 wrong attempts, and rate limited per recipient and per IP address.
- Stored only as a salted hash. A code that was accepted is never accepted again.

## Files

- Uploaded PDFs are size-capped and parsed defensively.
- Signature images are size-capped and re-encoded to PNG before they are drawn.

## Audit trail and seal

- Every action is appended to a log chained with SHA-256. Changing or removing an event breaks
  the chain, and the head is printed in the sealed PDF.
- The final file carries a PAdES seal; any later edit makes it invalid.

## Webhooks

- Outbound webhooks are signed with HMAC-SHA256 over a timestamp and the body, and retried with
  backoff.
- Inbound provider webhooks, such as Leegality's, are verified before they are trusted.

## Data

- Secrets are never logged. Errors never contain documents or credentials.
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
