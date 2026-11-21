---
'web': patch
---

Uploading a PDF that already carries digital signatures shows "This PDF already carries
digital signatures. Signing it again here would remove them. Upload the unsigned original."
New optional settings `SEAL_TSA_URL` and `SEAL_TSA_REQUIRED` add an RFC 3161 timestamp to
every seal. The deploy guide issues the seal certificate from a private root.
