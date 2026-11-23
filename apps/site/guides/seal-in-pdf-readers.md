---
title: How the seal works in PDF readers
description: What the seal on a signed PDF is, what a PDF reader shows for it, how certificates come into it, and the ways to verify a document.
---

# How the seal works in PDF readers

Every document completed in Codevibe Sign is sealed: the final PDF, with its signing
certificate page, carries one digital signature (PAdES) over the whole file. This page
explains what that means when you open the file, and how to check it.

## What the seal proves

The seal covers every byte of the file. If anything changes afterwards, even one character,
the seal no longer matches and every check says so. An intact seal therefore means the
document is exactly what was signed and sealed.

Who signed, how they proved who they are and when is on the certificate page at the end of
the file, and in full in the audit trail.

## Three ways to verify

1. **Scan the QR code** on the certificate page, or open the link printed beside it. The
   public record shows the seal status, the signers, the fingerprints and the audit trail. It
   never shows the document itself.
2. **Drop the PDF on the verify page** of the site that sealed it, for the cloud
   [sign.codevibe.in/verify](https://sign.codevibe.in/verify). It checks the seal and shows the
   same record. The file is checked in memory and not kept.
3. **Check it yourself**, offline, with `verify()` from `@codevibe_technology/sign-pdf` or the
   `codevibe-sign verify` command. See [Verify a sealed PDF](./verify-pdf).

## What a PDF reader shows

Readers that understand digital signatures, such as Adobe Acrobat Reader, check the seal
when the file opens and report two separate things:

- **Whether the document changed.** This is the integrity check, and it works for any seal.
  "The document has not been modified since this signature was applied" is the line to look
  for. A message that the document was modified means the file is not the sealed one.
- **Whether the reader knows the certificate.** Each reader keeps its own list of certificate
  issuers. A seal made with a certificate from one of them is named as trusted
  automatically. A seal made with any other certificate, such as an organisation's own, is
  shown as intact with a note that the reader does not know the signer yet. That note is
  about the reader's list, not about the document.

Preview on a Mac, browsers and most phone viewers show the pages and do not check
signatures at all. Use one of the three ways above instead.

## The seal certificate

The cloud at sign.codevibe.in seals with this certificate:

| Field               | Value                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Subject             | CN=Codevibe Sign, O=Codevibe Technology, C=IN                                     |
| Issuer              | Codevibe Technology                                                               |
| Valid               | 20 November 2026 to 19 November 2029                                              |
| Key                 | RSA 3072, SHA-256                                                                 |
| SHA-256 fingerprint | `6B6E D7EC C18F C1B1 B6F5 514C 58C2 13B4 8840 528D 665D F007 0D63 90AF 73DF 9C80` |

<p><a href="/docs/codevibe-sign-seal.crt" download>Download codevibe-sign-seal.crt</a></p>

The file holds the public certificate only. The verify page shows the same fingerprint. To
compare the file with it:

```sh
openssl x509 -in codevibe-sign-seal.crt -noout -fingerprint -sha256
```

On Windows, in PowerShell:

```powershell
(Get-PfxCertificate .\codevibe-sign-seal.crt).GetCertHashString('SHA256')
```

## Adding the certificate to your reader

This is optional. It makes your reader name the seal as trusted when it opens a file. In
Acrobat or Acrobat Reader:

1. Open **Edit > Preferences** (on a Mac, **Acrobat > Settings**).
2. Choose **Signatures**. Under **Identities & Trusted Certificates**, select **More**.
3. Select **Trusted Certificates**, then **Import**.
4. Browse to `codevibe-sign-seal.crt`, select **Import**, and confirm.
5. Select the imported "Codevibe Sign" certificate, choose **Edit Trust**, and tick
   **Use this certificate as a trusted root**. Leave certified documents and dynamic content
   unticked; the seal does not need them.
6. Close the dialogs and reopen the PDF.

The setting lives in that copy of the reader. An IT team can roll it out to a whole
organisation.

## Aadhaar eSign files on Windows

PDFs signed with Aadhaar eSign carry the signer's own signature from a licensed eSign Service
Provider, and the Codevibe Sign seal after it. A reader lists two signatures. The first covers
the file as the signer saw it; the reader notes that a signature was added later, which is the
seal and not a change to the document. Those certificates chain to the Controller of Certifying Authorities (CCA) India
root, which is in the Windows certificate store. To have Acrobat use that store:

1. Open **Edit > Preferences > Signatures**.
2. Under **Verification**, select **More**.
3. Under **Windows Integration**, tick **Trust ALL root certificates in the Windows Certificate
   Store** for validating signatures.
4. Select **OK** and reopen the PDF.

## Self-hosted installs

Your install seals with your own certificate. Its public part is at
`https://<your host>/verify/certificate`, your verify page shows its fingerprint, and the QR
code on each certificate page opens the record on your own host. To have readers name your
seal as trusted without anyone adding the certificate, seal with a document-signing
certificate from a certificate authority on the readers' lists; see
[Sealing](/concepts/sealing).
