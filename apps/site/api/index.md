---
title: API reference
description: Reference pages for each Codevibe Sign package - core, pdf, server, react and aadhaar - and what each one depends on.
---

# API reference

Codevibe Sign is split into small packages with one job each. Use the whole service, or only the
parts you need.

| Package                                             | What it does                                                                        | Status       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| [`@codevibe_technology/sign-core`](/api/core)       | Domain rules: envelopes, routing, reminders, expiry, the audit chain, tokens, OTPs. | Ready to try |
| [`@codevibe_technology/sign-pdf`](/api/pdf)         | Draws field values, appends the certificate page, seals and verifies PDFs.          | Ready to try |
| [`@codevibe_technology/sign-server`](/api/server)   | HTTP API and runtime, with adapters for storage, files, mail and OTP.               | Ready to try |
| [`@codevibe_technology/sign-react`](/api/react)     | Signature pad, signing view and field placement components.                         | Ready to try |
| [`@codevibe_technology/sign-aadhaar`](/api/aadhaar) | Aadhaar eSign through a licensed eSign provider, with your own account.             | Ready to try |

For the HTTP API itself, with every route, schema and error code, see the
[HTTP API reference](/http-api), which you can try against your own server.

All packages share one version number and are released together, starting at `0.1.0`. Their
APIs may change in a minor release before 1.0.

`codevibe-sign` and every library above except `sign-server` are Apache-2.0.
`@codevibe_technology/sign-server` is AGPL-3.0-only and is installed on its own.

## Conventions

- TypeScript, strict, ESM first, with CommonJS builds and type declarations. Node 22 or later.
- Each package's public API is exported only from its entry point.
- Errors are `SignError` instances with a stable `code`, never bare strings. See the
  [error codes](/api/core#error-codes).

## Dependencies

| Package        | Depends on                                           |
| -------------- | ---------------------------------------------------- |
| `sign-core`    | nothing at runtime                                   |
| `sign-pdf`     | `pdf-lib`, `@signpdf/*`, `node-forge`                |
| `sign-server`  | core, pdf, `hono`, `nodemailer`, `postgres`          |
| `sign-react`   | core; `react`, `react-dom` and `pdfjs-dist` as peers |
| `sign-aadhaar` | core                                                 |
