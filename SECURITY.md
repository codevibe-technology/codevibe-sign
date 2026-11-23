# Security policy

Codevibe Sign handles signed agreements and personal data, so we take reports seriously and
reply quickly.

How the project defends itself, and what is left to deployers, is described in
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). If you run the server, work through
[docs/SECURITY-CHECKLIST.md](docs/SECURITY-CHECKLIST.md) before going live.

## The seal certificate and the sealing key

Every completed PDF is sealed with a certificate. The **certificate** is public on purpose: it
holds only the public key, so anyone can use it to check a seal, and nobody can use it to make
one. The **private key** that makes seals is the secret.

- Files completed on sign.codevibe.in are sealed with `CN=Codevibe Sign, O=Codevibe Technology, C=IN`,
  SHA-256 fingerprint
  `6B6E D7EC C18F C1B1 B6F5 514C 58C2 13B4 8840 528D 665D F007 0D63 90AF 73DF 9C80`. Download it
  from [sign.codevibe.in/verify/certificate](https://sign.codevibe.in/verify/certificate) and
  check files at [sign.codevibe.in/verify](https://sign.codevibe.in/verify). What a PDF reader
  shows for the seal is explained in
  [How the seal works in PDF readers](https://sign.codevibe.in/docs/guides/seal-in-pdf-readers).
- The private key never leaves the server and is never committed: `*.p12` and `deploy/secrets/`
  are in `.gitignore`. The server refuses RSA keys under 2048 bits, SHA-1 or MD5 certificates
  and certificates that are not valid yet.
- If you self-host, your files are sealed with **your own** certificate. Keep the `.p12` and its
  passphrase in `deploy/secrets/` or a secret manager, back them up offline, and publish your
  certificate's fingerprint so recipients can check your files.
- A leaked, weak or misused sealing key is in scope. Report it straight away.

## Reporting a vulnerability

Email **security@codevibe.in**. Please do not open a public issue, pull request or discussion.

Include what you found, the affected package and version, steps to reproduce and the impact you
expect. A proof of concept helps. If you would like to encrypt your report, ask for a key in a
first message without details.

What to expect:

- an acknowledgement within 3 working days;
- an assessment and a plan within 10 working days;
- a fix released as soon as it is ready, with a security note in the changelog and credit to
  you if you want it.

Please give us a reasonable time to release a fix before you disclose the problem publicly, and
do not access, change or delete data that is not yours while testing.

## Supported versions

| Version                | Supported                                             |
| ---------------------- | ----------------------------------------------------- |
| Latest minor release   | Yes                                                   |
| Previous minor release | Security fixes for 3 months after a new minor release |
| Older releases         | No                                                    |

Until 1.0, only the latest minor release is supported.

## In scope

- All packages in this repository (`@codevibe_technology/sign-*`) and the `apps/server` image.
- Signing-link tokens, OTP handling and rate limits.
- The audit hash chain, the certificate page, sealing and `verify()`: anything that lets a
  changed document or audit trail pass as valid.
- Webhook signing (outbound) and provider webhook verification (inbound).
- Injection, access control between envelopes or API keys, and leaks of secrets or personal
  data in logs, errors or responses.

## Out of scope

- Vulnerabilities in third-party eSign providers, mail servers or other services this project
  connects to (report those to the vendor).
- Deployments that ignore the documented configuration, such as running without TLS or
  publishing the sealing key.
- Denial of service through traffic volume, and reports from automated scanners without a
  working impact.
