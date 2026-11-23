# Architecture

Codevibe Sign sends documents for signature, collects signatures, seals the final
PDF against tampering and records a verifiable audit trail. It is a set of small
packages you can embed in your own product, or run as a standalone service.

## Packages

| Package                             | What it does                                                                                                                                                                    | Depends on                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `@codevibe_technology/sign-core`    | Domain model and rules: envelopes, recipients, fields, the signing workflow, reminders and expiry, the hash-chained audit log, OTP policy. No I/O.                              | nothing at runtime                    |
| `@codevibe_technology/sign-pdf`     | PDF work: read page sizes, draw signatures and field values, append the signing certificate page, flatten, apply and verify a PAdES seal.                                       | `pdf-lib`, `@signpdf/*`, `node-forge` |
| `@codevibe_technology/sign-server`  | HTTP API and runtime: stores envelopes, sends invitations and OTPs, runs signing sessions, fires webhooks, produces the sealed file. Adapters for storage, files, mail and OTP. | core, pdf, `hono`                     |
| `@codevibe_technology/sign-client`  | Typed client for the HTTP API: sending, signing sessions, webhook checks. Uses `fetch` and Web Crypto only.                                                                     | nothing at runtime                    |
| `@codevibe_technology/sign-react`   | UI: signature pad (draw, type, upload), signing view for recipients, field placement for senders. Unstyled by default, themed with CSS variables.                               | core, `react` (peer)                  |
| `@codevibe_technology/sign-aadhaar` | Aadhaar eSign through a licensed eSign provider, using the integrator's own provider account.                                                                                   | core                                  |

Two more packages sit on top of these: `@codevibe_technology/sign-templates` (reusable
templates and bulk drafts from a CSV file; depends on core) and `codevibe-sign`, the one
package to install, which re-exports the others under subpaths and adds the `codevibe-sign`
command line.

Apps: `apps/web` (the product: workspaces, sending, the signing page and the HTTP API in one
Next.js server; see [APP-ARCHITECTURE.md](APP-ARCHITECTURE.md)), `apps/server` (Docker image
of the standalone API service), `apps/site` (the documentation) and `apps/playground` (a local
demo of the full flow).

## Core model

```
Envelope ──< Document ──< Field >── Recipient
    │                                   │
    └──────────── AuditEvent ───────────┘
```

- **Envelope**: one signing request. Has documents, recipients, a routing mode
  (`sequential` or `parallel`), an expiry and a reminder policy.
- **Recipient**: `signer`, `approver` or `viewer` (receives a copy). Signers have an
  `order` used in sequential routing, an authentication method (`email_link`,
  `email_otp`, `sms_otp`, `aadhaar`) and a status.
- **Field**: a placed box on a page, in PDF points with a top-left origin:
  `signature`, `initials`, `date_signed`, `name`, `text`, `checkbox`. Each field
  belongs to one recipient and may be required.
- **AuditEvent**: every action, append-only, chained by SHA-256 (`hash = sha256(prevHash + canonical(event))`).
  The chain is printed on the certificate page and can be verified offline.

### Envelope status

```
draft ──send──▶ sent ──first signature──▶ in_progress ──last required action──▶ completed
                 │                            │
                 ├── declined (any signer) ◀──┤
                 ├── expired  (past expiry) ◀─┤
                 └── voided   (sender)     ◀──┘
```

`completed`, `declined`, `expired` and `voided` are final. Every transition is a pure
function in core that returns the new state plus the audit events and side effects
(emails, webhooks) to perform. The server performs them; core never does I/O.

### Recipient status

`pending → notified → viewed → (signed | approved | declined)`. In sequential routing
only the lowest unfinished `order` is `notified`.

## Ports (implemented by the server or the integrator)

Defined in `@codevibe_technology/sign-core` (`ports.ts`): `EnvelopeStore`, `FileStore`,
`Mailer`, `OtpSender`, `Clock`, `IdGenerator`, `Hasher`. Core functions take the
ports they need as arguments; nothing is global.

## Sealing

1. Draw every field value onto the original pages.
2. Append a certificate page: envelope id, document SHA-256 before and after,
   each recipient (name, email or phone, authentication used, IP, user agent,
   time of each action) and the audit chain head hash.
3. Apply a PAdES-B detached signature with the operator's certificate (PKCS#12).
   Any later edit makes the seal invalid in Adobe Reader and in `verify()`.

The operator certificate is the platform's, not the signer's: it proves the file
has not changed since sealing. Signer intent is proven by the audit trail.

## Legal position (India, and in general)

- The built-in signature is an electronic record of agreement (Information
  Technology Act 2000, s.10A; Indian Contract Act). It suits offer letters,
  policies, NDAs and most business documents. The audit trail is the evidence.
- Documents that a law requires to be "signed" in the statutory sense need an
  electronic signature under IT Act s.3A, such as Aadhaar eSign through a licensed
  provider (`@codevibe_technology/sign-aadhaar`) or a DSC.
- Some documents cannot be signed electronically at all (IT Act, First Schedule, as
  amended by S.O. 4720(E) of 2022): wills, trusts, most powers of attorney and most
  negotiable instruments other than cheques.

This is not legal advice; integrators should take their own.

## Security rules

- Signing links carry a random token (32 bytes, base64url), stored only as a hash,
  single envelope, expiring, revocable.
- OTPs: 6 digits, 10 minutes, 5 attempts, rate limited per recipient and IP, stored hashed.
- Uploaded PDFs are size-capped and parsed defensively; signature images are
  re-encoded to PNG and size-capped.
- Webhooks are signed (HMAC-SHA256 over timestamp and body) and retried with backoff.
- No secrets in logs. Personal data in the audit log is limited to what the
  certificate needs.

## Conventions

- TypeScript strict, ESM first (`tsup` builds ESM and CJS with types), Node 20+.
- `vitest` for tests; every package keeps its own tests next to the code.
- Errors are typed (`SignError` with a stable `code`), never bare strings.
- Public API is exported only from each package's `src/index.ts`.
- Conventional Commits; changesets for releases.
