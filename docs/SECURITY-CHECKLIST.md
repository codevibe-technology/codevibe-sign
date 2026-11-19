# Security checklist for deploying the server

Work through this list before you put Codevibe Sign in front of real signers. Each item says what
to do and why. The reasoning behind them is in [THREAT-MODEL.md](THREAT-MODEL.md).

## Network and TLS

- [ ] Terminate TLS in front of the server (nginx, Caddy, Traefik or a cloud load balancer) with
      TLS 1.2 or later and a certificate from a public CA. Signing links, OTPs and documents are
      bearer secrets in transit.
- [ ] Redirect plain HTTP to HTTPS and send `Strict-Transport-Security: max-age=31536000`.
- [ ] Set `PUBLIC_URL` to the `https://` address recipients use. The server refuses `http` except
      for localhost.
- [ ] Do not expose the container port directly; only the proxy should reach it. Bind it to a
      private interface or a container network.
- [ ] Keep the database and file store off the public internet. Require TLS for the database
      connection when it crosses hosts (`sslmode=verify-full` in `DATABASE_URL`).
- [ ] Use an SMTP relay over TLS (`SMTP_SECURE=true` on 465, or STARTTLS on 587).

## Seal key

- [ ] Use a certificate made for sealing, not a TLS certificate and not a personal one: RSA 2048
      or larger (or ECDSA P-256), SHA-256, with the organisation name your recipients expect to see.
- [ ] Prefer a certificate from a CA that Adobe Reader trusts (AATL) if recipients will open the
      sealed files in Reader. A self-issued certificate still detects changes but shows as
      "unknown signer".
- [ ] Keep the PKCS#12 file and its passphrase in a secret manager (Docker or Kubernetes secrets,
      Vault, a cloud KMS or secret store). Never commit them, never bake them into an image, and
      never put them in a `.env` file that is copied around.
- [ ] Give the passphrase only to the server process. Restrict who can run `docker inspect`,
      `kubectl describe` or read the host's environment.
- [ ] Note the certificate's expiry date and set a reminder 60 days before it.
- [ ] Keep the public certificate of every key you have ever used, so old sealed files can still
      be verified after rotation.
- [ ] Have a plan for a leaked key: revoke the certificate with the CA, issue a new one, restart
      the server, and tell recipients which seals to distrust.

## API keys

- [ ] Generate each key with a CSPRNG, at least 32 characters (`openssl rand -base64 32`). The
      server refuses shorter keys.
- [ ] Use one key per calling system so you can revoke one without touching the others.
- [ ] Rotate without downtime: add the new key to `API_KEYS` (comma-separated), deploy, switch the
      caller, then remove the old key and deploy again. Rotate at least every 90 days and at once
      when someone with access leaves.
- [ ] Call the API only from your backend. Never ship a key to a browser or mobile app.
- [ ] Store keys in your backend's secret manager, not in source control or CI logs.

## Outbound webhooks

- [ ] Register only `https` webhook URLs on hosts you control.
- [ ] If your deployment can reach internal services, configure the webhook host allow-list so
      the server cannot be pointed at internal addresses. Private, loopback and link-local
      addresses (including `169.254.169.254`, cloud metadata) are refused regardless.
- [ ] Verify every webhook you receive: recompute the HMAC-SHA256 over the timestamp and the raw
      body with your endpoint secret, compare in constant time, reject timestamps older than five
      minutes and event ids you have already processed.
- [ ] Rotate webhook secrets like API keys, and keep the old secret valid only until the switch.
- [ ] Make your handler idempotent: the server retries with backoff, so the same event can arrive
      more than once.

## Aadhaar eSign provider (if used)

- [ ] Keep `confirmWebhooks` on (the default). With it off, a single captured callback lets
      someone forge any status for that document.
- [ ] If your provider can add a static header to callbacks, configure it and pass it as
      `webhookHeader`.
- [ ] Use the sandbox environment and credentials only outside production, and never mix them.
- [ ] Treat the provider auth token and private salt like API keys: secret manager, rotation,
      no logging.

## Rate limits behind a proxy

- [ ] Tell the server how many proxies sit in front of it so it takes the client IP from the
      right `X-Forwarded-For` entry. Trusting the header blindly lets anyone choose their own IP,
      which defeats per-IP limits and puts false IPs in the audit trail.
- [ ] Make the proxy overwrite (not append to) `X-Forwarded-For` from untrusted clients, or strip
      it on the edge.
- [ ] Keep the server's per-recipient OTP and signing limits on. Add proxy limits for the public
      signing routes as a first line, for example 30 requests per minute per IP.
- [ ] Cap request bodies at the proxy at the same size as the server's PDF limit (25 MB by
      default) and much lower on signing routes (1 MB is plenty for a signature image).
- [ ] Set proxy timeouts so slow uploads cannot hold connections open (for example 60 s for
      uploads, 15 s elsewhere).

## Logs and retention

- [ ] Configure access logs to drop query strings and the signing path segment that holds a token,
      and never log `Authorization`, `Cookie` or `Set-Cookie` headers.
- [ ] Do not turn on request or response body logging in the proxy or an APM agent; bodies carry
      documents, signature images and OTPs.
- [ ] Keep application logs for as long as you need them to investigate incidents (30 to 90 days
      is typical), then delete them. Logs are not the evidence; the audit trail is.
- [ ] Restrict who can read logs. They still contain envelope ids, IPs and email addresses.
- [ ] Decide and document how long you keep envelopes, documents and audit events. Signed
      agreements often need to be kept for years (employment and tax records in India commonly
      eight years); personal data in drafts and expired envelopes usually does not.

## Backups of the audit tables and files

- [ ] Back up the database (envelopes, audit events, tokens) and the file store together, on the
      same schedule, so a restore gives matching records and files.
- [ ] Encrypt backups and keep them in a separate account or project from production, so one
      leaked credential cannot delete both.
- [ ] Keep at least one copy write-once (object lock or an equivalent) for the retention period.
      This protects the audit trail from someone with database access rewriting it.
- [ ] Test a restore every quarter, and after restoring, run `verifyChain` over a sample of
      envelopes with `expectedHead` set to the head printed on their sealed certificates and
      `envelopeId` set to the envelope's id.
- [ ] Never edit audit rows by hand, even to "fix" data. Record a correction as a new event.

## Database access

- [ ] Run the server with a database role that can insert audit events but not update or delete
      them (grant `INSERT, SELECT` on the audit table only).
- [ ] Give administrators read-only roles by default and log every use of a write role.
- [ ] For high-value documents, export each new audit head to a store the database administrators
      cannot write (an RFC 3161 timestamp, a write-once bucket or another system's log).

## Container and host

- [ ] Run the published image as is: it runs as the unprivileged `node` user. Add
      `--read-only` with a writable volume for `/data`, and `--cap-drop ALL`.
- [ ] Keep the host and the image up to date. Rebuild when a new release or a Node security
      release comes out.
- [ ] Watch the security advisories for this project and for your eSign provider.

## Before go-live

- [ ] Send a test envelope end to end, open the sealed PDF in Adobe Reader and confirm the seal
      shows as valid and the certificate page lists the right people and times.
- [ ] Change one byte of the sealed file and confirm `verify()` and Reader both report it.
- [ ] Try a wrong OTP six times and confirm the code locks.
- [ ] Open a signing link after the envelope completes and confirm it no longer works.
- [ ] Confirm nothing sensitive reaches the logs during those tests.
