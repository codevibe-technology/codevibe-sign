---
title: Trust the Codevibe Sign seal in Adobe
description: Why Adobe Reader shows a Codevibe Sign seal as "signer identity unknown", how to check it, and how to import the seal certificate so Reader trusts it.
---

# Trust the Codevibe Sign seal in Adobe

Every PDF completed on sign.codevibe.in carries a PAdES seal made with the Codevibe Sign seal
certificate. Adobe Acrobat and Reader check that seal as soon as you open the file.

## What Reader shows today

The seal certificate is issued by Codevibe Technology itself. It is not on the Adobe Approved
Trust List (AATL), so out of the box Reader shows a yellow banner:

- **Signature validity is UNKNOWN**
- **The document has not been modified since this signature was applied**
- **The signer's identity is unknown**

The second line is the one that matters for integrity: the file is exactly what was sealed.
The third line only says that Reader does not know the certificate yet. A red cross, or a
message that the document was modified, means the file was changed after sealing; do not rely
on it.

You can confirm a file without Adobe at [sign.codevibe.in/verify](https://sign.codevibe.in/verify).
It checks the same seal and also shows the signers, their times and whether the audit trail is
intact.

## The seal certificate

| Field               | Value                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Subject             | CN=Codevibe Sign, O=Codevibe Technology, C=IN                                     |
| Issuer              | Itself (self-signed)                                                              |
| Valid               | 20 November 2026 to 19 November 2029                                              |
| Key                 | RSA 3072, SHA-256                                                                 |
| SHA-256 fingerprint | `6B6E D7EC C18F C1B1 B6F5 514C 58C2 13B4 8840 528D 665D F007 0D63 90AF 73DF 9C80` |

<p><a href="/docs/codevibe-sign-seal.crt" download>Download codevibe-sign-seal.crt</a></p>

The file holds the public certificate only. Before you trust it, check that its SHA-256
fingerprint matches the one above, for example:

```sh
openssl x509 -in codevibe-sign-seal.crt -noout -fingerprint -sha256
```

On Windows, in PowerShell:

```powershell
(Get-PfxCertificate .\codevibe-sign-seal.crt).GetCertHashString('SHA256')
```

The same fingerprint is shown on the [verify page](https://sign.codevibe.in/verify).

## Import it into Acrobat or Reader

1. Open **Edit > Preferences** (on a Mac, **Acrobat > Settings**).
2. Choose **Signatures**. Under **Identities & Trusted Certificates**, select **More**.
3. Select **Trusted Certificates**, then **Import**.
4. Browse to `codevibe-sign-seal.crt`, select **Import**, and confirm.
5. Select the imported "Codevibe Sign" certificate, choose **Edit Trust**, and tick
   **Use this certificate as a trusted root**. Leave certified documents and dynamic content
   unticked; the seal does not need them.
6. Close the dialogs and reopen the PDF.

Reader now shows the seal as valid and the signer as Codevibe Sign. This trust lives only in
your copy of Reader. Everyone who should see the green tick has to import the certificate
themselves, or their IT team can push it out.

## Aadhaar eSign files on Windows

PDFs signed with Aadhaar eSign carry the signer's own signature from a licensed eSign Service
Provider. Those certificates chain to the Controller of Certifying Authorities (CCA) India root,
which is in the Windows certificate store but not in Adobe's own list. On Windows:

1. Open **Edit > Preferences > Signatures**.
2. Under **Verification**, select **More**.
3. Under **Windows Integration**, tick **Trust ALL root certificates in the Windows Certificate
   Store** for validating signatures.
4. Select **OK** and reopen the PDF.

## A green tick without importing

Reader trusts a seal on its own only when the certificate comes from an AATL member. The seal
on sign.codevibe.in is self-signed today. Importing it, or checking on the verify page, gives
the same integrity guarantee; only the trust prompt differs.

## Self-hosted installs

Your install seals with your own certificate. Its public part is at
`https://<your host>/verify/certificate`, and your verify page shows its fingerprint. Follow the
same import steps with that file.
