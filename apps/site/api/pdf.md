---
title: '@codevibe/sign-pdf'
description: API reference for @codevibe/sign-pdf - reading page sizes, drawing field values, the certificate page, PAdES sealing and verification.
---

# @codevibe/sign-pdf

<ComingSoon pkg="@codevibe/sign-pdf" />

All the PDF work in Codevibe Sign: read page sizes, draw signatures and field values, append
the signing certificate page, flatten, and apply and verify a PAdES seal.

```sh
pnpm add @codevibe/sign-pdf
```

Depends on `pdf-lib`, `@signpdf/*` and `node-forge`.

## What it will cover

| Area             | Purpose                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Inspect          | Read the page count and page sizes of an uploaded PDF and hash it, defensively and size-capped. |
| Draw             | Draw every field value onto the original pages, converting from the top-left origin.            |
| Certificate page | Append the envelope id, document hashes, each recipient's actions and the audit chain head.     |
| Seal             | Apply a PAdES-B detached signature with the operator's PKCS#12 certificate.                     |
| `verify()`       | Check the seal and read the certificate page, without contacting the server.                    |

## API

The function list and options will be published here from the package README when it is
merged.
