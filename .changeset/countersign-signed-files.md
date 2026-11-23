---
'@codevibe_technology/sign-pdf': minor
---

`countersign` seals a PDF that already carries digital signatures, such as an Aadhaar eSign
from an eSign provider, by appending an incremental update: the existing bytes and
signatures stay as they are and the operator's seal covers them. `verifySignatures` lists
every signature of a file with whether it is intact, and reads RSA (PKCS#1 v1.5 and PSS) and
ECDSA signatures from other products. `verify` takes `allowEarlierSignatures` to accept a
countersigned file, reports the earlier signatures and fails with
`earlier_signature_invalid` when one of them is broken.
