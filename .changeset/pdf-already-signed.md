---
'@codevibe_technology/sign-core': minor
'@codevibe_technology/sign-pdf': minor
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-client': patch
'codevibe-sign': patch
---

Refuse PDFs that already carry digital signatures instead of silently removing them.

- Core: new error code `PDF_ALREADY_SIGNED`.
- PDF: `inspectPdf` throws `PDF_ALREADY_SIGNED` (with `details.signatureCount`) for a file with
  signed `/Sig` fields, with the message "This PDF already carries digital signatures. Signing
  it again here would remove them. Upload the unsigned original." (`ALREADY_SIGNED_MESSAGE`).
  `seal` refuses such a file too (`details.step: 'seal'`), since it rewrites the whole file.
- Server: envelope uploads and document replacements answer 422 `PDF_ALREADY_SIGNED`; the
  OpenAPI document lists the code.
- Client: `SignApiError.code` can be `PDF_ALREADY_SIGNED`.
- CLI: `codevibe-sign inspect` reports an already signed file as not usable (`problem:
already_signed`, exit code 1).
