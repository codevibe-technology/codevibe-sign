---
'@codevibe_technology/sign-aadhaar': minor
'@codevibe_technology/sign-core': minor
'@codevibe_technology/sign-pdf': minor
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-react': minor
'@codevibe_technology/sign-templates': patch
---

An Aadhaar eSign signer may have one optional `aadhaar` field again, the Aadhaar seal
position: it only says where the eSign provider draws its signature, takes no value and is
never drawn. Core keeps it when signature and initials fields are dropped
(`dropAadhaarSignatureFields`) and refuses a second one; `aadhaarSealPosition` returns it. The
server passes it to the provider as `signaturePositions` with the page's crop box and rotation
(`inspectPdf` in the PDF package now reports `boxes`). The placer offers it, with the quick add
"Aadhaar seal on last page", only for that signer.

The Leegality adapter takes a `v4` workflow (`leegalityV4WorkflowFromPayload` reads one from the
dashboard's downloaded API payload) and a `coordinates` mapping (default PDF points from the
bottom-left). A request with positions then goes to the v4 Pack API with per-request
coordinates and Webhook 4.0; its `providerRef` is `v4:<packId>:<documentId>`, and webhooks,
status checks and downloads follow the v4 API. Requests without positions keep using v3.0.
