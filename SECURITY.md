# Security policy

Codevibe Sign handles signed agreements and personal data, so we take reports seriously and
reply quickly.

How the project defends itself, and what is left to deployers, is described in
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). If you run the server, work through
[docs/SECURITY-CHECKLIST.md](docs/SECURITY-CHECKLIST.md) before going live.

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
