---
title: API reference
description: Reference pages for each Codevibe Sign package - core, pdf, server, react and aadhaar - and what each one depends on.
---

# API reference

Codevibe Sign is split into small packages with one job each. Use the whole service, or only the
parts you need.

| Package                               | What it does                                                                        | Status       |
| ------------------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| [`@codevibe/sign-core`](./core)       | Domain rules: envelopes, routing, reminders, expiry, the audit chain, tokens, OTPs. | Ready to try |
| [`@codevibe/sign-pdf`](./pdf)         | Draws field values, appends the certificate page, seals and verifies PDFs.          | Coming soon  |
| [`@codevibe/sign-server`](./server)   | HTTP API and runtime, with adapters for storage, files, mail and OTP.               | Coming soon  |
| [`@codevibe/sign-react`](./react)     | Signature pad, signing view and field placement components.                         | Coming soon  |
| [`@codevibe/sign-aadhaar`](./aadhaar) | Aadhaar eSign through a licensed eSign provider, with your own account.             | Ready to try |

All packages are pre-release (`0.0.0`) and their APIs may change before 0.1.

## Conventions

- TypeScript, strict, ESM first, with CommonJS builds and type declarations. Node 20 or later.
- Each package's public API is exported only from its entry point.
- Errors are `SignError` instances with a stable `code`, never bare strings. See the
  [error codes](./core#error-codes).

## Dependencies

| Package        | Depends on                            |
| -------------- | ------------------------------------- |
| `sign-core`    | nothing at runtime                    |
| `sign-pdf`     | `pdf-lib`, `@signpdf/*`, `node-forge` |
| `sign-server`  | core, pdf, `hono`                     |
| `sign-react`   | core, `react` (peer)                  |
| `sign-aadhaar` | core                                  |
