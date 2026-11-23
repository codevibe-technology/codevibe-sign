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
- [ ] Route `/sign/*` on the public host to the server, next to `/v1/sign/*`. Signing links
      open `/sign/<token>`, which moves the token into an HttpOnly, SameSite=Strict cookie and
      redirects to the signing page without it. Serve the signing page from the same origin.
- [ ] Keep the database and file store off the public internet. Require TLS for the database
      connection when it crosses hosts (`sslmode=verify-full` in `DATABASE_URL`).
- [ ] Use an SMTP relay over TLS (`SMTP_SECURE=true` on 465, or STARTTLS on 587).

## Seal key

- [ ] Use a certificate made for sealing, not a TLS certificate and not a personal one: RSA 2048
      or larger, signed with SHA-256, with the organisation name your recipients expect to see.
      The server refuses to start with a shorter key, a SHA-1 certificate or an expired one.
      `sealer.allowWeakKey` exists for throwaway keys in local development; never set it in
      production.
- [ ] Any certificate detects changes. Use one from a public document-signing CA if recipients'
      PDF readers should name the sealer on their own, without adding your certificate.
- [ ] Keep the PKCS#12 file and its passphrase in a secret manager (Docker or Kubernetes secrets,
      Vault, a cloud KMS or secret store). Never commit them, never bake them into an image, and
      never put them in a `.env` file that is copied around.
- [ ] Give the passphrase only to the server process. Restrict who can run `docker inspect`,
      `kubectl describe` or read the host's environment.
- [ ] Note the certificate's expiry date and set a reminder 60 days before it.
- [ ] Keep the public certificate of every key you have ever used, so old sealed files can still
      be verified after rotation. Pass the old ones as `sealer.trust.certificates` so the
      server's verification route keeps accepting them, and to `verify()` wherever you check
      files.
- [ ] Check sealed files with `verify(bytes, { trust })`, never with `verifySeal` alone:
      `verifySeal` accepts a seal made with any key.
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
- [ ] To keep plain keys out of the server's configuration, pass `{ id, sha256 }` with the
      key's SHA-256 (`printf %s "$KEY" | sha256sum`). The server keeps only hashes either way.

## Outbound webhooks

- [ ] Register only `https` webhook URLs on hosts you control. The server refuses `http`, bare
      IP addresses, credentials in the URL and privileged ports other than 443.
- [ ] Leave the address checks on: every delivery resolves the host and refuses loopback,
      private, link-local (including `169.254.169.254`, cloud metadata), CGNAT, multicast and
      reserved addresses, then connects to the address it checked. Never set
      `webhookSecurity.allowInsecure` outside local development.
- [ ] If webhooks must reach an internal service, list exactly those hosts in
      `webhookSecurity.allowHosts`; every other host is then refused.
- [ ] Let the server make the connection. A custom `fetch` keeps the URL and address checks but
      cannot pin the connection to the checked address.
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
- [ ] Point the provider's webhook at `POST /v1/esign/webhooks/<provider>` over https. The
      route is public by design: it verifies each body with the credentials of the workspace
      that started the request and answers 404 to anything it cannot match.
- [ ] When workspaces bring their own provider account, encrypt the credentials at rest and
      build the provider per workspace in `esign.provider`; never fall back to another
      workspace's account.
- [ ] Make `esign.onStart` and `esign.onEnd` idempotent on `ref`: they are where credits are
      reserved and settled, and `onEnd` is retried.

## Rate limits behind a proxy

- [ ] Tell the server how many proxies sit in front of it so it takes the client IP from the
      right `X-Forwarded-For` entry: `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS` (default 1),
      or `trustProxy` and `trustedProxyHops`. The server counts that many entries from the
      right, the ones your proxies wrote. Trusting the header blindly lets anyone choose their
      own IP, which defeats per-IP limits and puts false IPs in the audit trail.
- [ ] Make the proxy overwrite (not append to) `X-Forwarded-For` from untrusted clients, or strip
      it on the edge.
- [ ] Keep the server's per-recipient OTP and signing limits on. Add proxy limits for the public
      signing routes as a first line, for example 30 requests per minute per IP.
- [ ] Cap request bodies at the proxy at the same size as the server's PDF limit (25 MB by
      default) and much lower on signing routes (1 MB is plenty for a signature image).
- [ ] Set proxy timeouts so slow uploads cannot hold connections open (for example 60 s for
      uploads, 15 s elsewhere).

## Logs and retention

- [ ] Configure the proxy's access logs to drop query strings and the signing path segment that
      holds a token (`/sign/<token>` and `/v1/sign/<token>/...`), and never log
      `Authorization`, `Cookie` or `Set-Cookie` headers. The server's own logs are redacted
      already; if you want its access log, set `accessLog: true` instead of logging in the proxy.
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

- [ ] Run the server with a database role that can insert and read audit events but never
      change or delete them, and that cannot delete envelopes (which would remove their events
      through the foreign key). Run migrations with a separate owner role. As a superuser:

      ```sql
      create role sign_owner login password '<long random password>';
      create role sign_app login password '<another long random password>';
      grant usage, create on schema public to sign_owner;
      grant usage on schema public to sign_app;

      -- Connect as sign_owner and run migrate() (or start the server once with its URL),
      -- then, still as sign_owner:
      grant select on sign_migrations to sign_app;
      grant select, insert, update on sign_envelopes to sign_app;
      grant select, insert on sign_audit_events to sign_app;
      grant select, insert, update, delete
        on sign_tokens, sign_otp_challenges, sign_idempotency, sign_jobs to sign_app;
      grant select, insert, update on sign_esign_sessions to sign_app;
      ```

      Start the server with `sign_app` in `DATABASE_URL`; on a migrated database its own
      `migrate()` only reads `sign_migrations`. When an upgrade adds migrations, run it once
      as `sign_owner` first and repeat the grants for any new table the release notes list.

- [ ] Give administrators read-only roles by default and log every use of a write role.
- [ ] For high-value documents, export each new audit head to a store the database administrators
      cannot write (an RFC 3161 timestamp, a write-once bucket or another system's log).

## Container and host

- [ ] Run the published image as is: it runs as the unprivileged `node` user. Add
      `--read-only` with a writable volume for `/data`, and `--cap-drop ALL`.
- [ ] Keep the host and the image up to date. Rebuild when a new release or a Node security
      release comes out.
- [ ] Watch the security advisories for this project and for your eSign provider.

## Dates on signed documents

- [ ] Set the default time zone your signers expect: `TIME_ZONE` for the standalone server,
      `SIGN_TIME_ZONE` for the web app, or the `timeZone` option, as an IANA name such as
      `Asia/Kolkata`. Without it the date under each signature is the UTC date, which is the
      previous day for anyone signing before 5:30 am in India.
- [ ] In the web app, check each workspace's own zone under Settings, Workspace, Time zone. It
      overrides the default for that workspace's documents and emails.

## Sign-in to the web app

- [ ] Serve the app over https only, so passwords and session cookies never cross the network
      in the clear, and set `TRUST_PROXY=true` only behind a proxy you control: the per-IP
      sign-in limit reads the client address from it.
- [ ] Make sure email works before inviting people: sign-in links, invitations, password
      resets and "your password was changed" notices all go by email.
- [ ] Run one process, or accept that the wrong-password pause and the email caps are counted
      per process.
- [ ] Tell admins that removing someone from a workspace does not delete their account; they
      can still sign in, and see nothing.

## Before go-live

- [ ] Send a test envelope end to end, check the sealed PDF on the verify page and in a PDF
      reader that checks signatures, and confirm the certificate page lists the right people
      and times and its QR code opens the record.
- [ ] Change one byte of the sealed file and confirm `verify()` and Reader both report it, and
      that `GET /v1/envelopes/:id/documents/:docId/verification` reports the stored file as
      valid.
- [ ] Sign a test document and confirm the date under the signature is today's date where
      your signers are.
- [ ] Sign in with a password, enter a wrong one six times and confirm the sixth is refused
      with a wait; then confirm "Email me a link instead" still signs you in.
- [ ] Open a signing link and confirm the browser lands on the signing page with no token in
      its address bar.
- [ ] Try a wrong OTP six times and confirm the code locks.
- [ ] Open a signing link after the envelope completes and confirm it no longer works and the
      page says the document is complete.
- [ ] Sign in a private window, close it, and confirm the signed copy can no longer be
      downloaded from that browser.
- [ ] Confirm nothing sensitive reaches the logs during those tests.
