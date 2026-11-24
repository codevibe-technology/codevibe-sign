# Changelog

The highlights of each Codevibe Sign release, for the whole project. The eight packages share one
version number and are released together. Each package also keeps its own `CHANGELOG.md`, written
by [Changesets](https://github.com/changesets/changesets) at release time, with every change in
full; GitHub releases carry the same notes. You can read this page on the
[docs changelog](https://sign.codevibe.in/docs/changelog?utm_source=github&utm_medium=changelog&utm_campaign=codevibe-sign) too.

Releases follow [semantic versioning](https://semver.org/). Before 1.0, a breaking change bumps
the minor version and says so in its first line.

## Unreleased

### Tests

- Test certificates start on a fixed past date, so tests that sign at a fixed time keep passing
  as the calendar moves on.

## 0.1.1 (24 November 2026)

### Aadhaar eSign

- **Choose where the Aadhaar signature appears.** The sender can place one Aadhaar seal box for
  an Aadhaar eSign signer. It only sets the position: the request then goes through Leegality's
  2.1 API with that box as coordinates, using the same Auth Token, so no new Leegality set-up is
  needed. Without a box the request and its workflow are unchanged. Coordinate units and origin
  are settings, checked with one calibration signing.

### In the web app

- **Idle sign-out and a daily sign-in in the web app.** App sessions end after 30 minutes
  without activity in any open tab (`SESSION_IDLE_MINUTES`, `0` turns it off), with a warning
  two minutes before, and at most 12 hours after signing in (`SESSION_MAX_HOURS`). The server
  enforces both, so a copied cookie stops working too. After an idle sign-out, signing in
  returns to the same page; a draft being sent is saved first. Signers on the signing page are
  not affected. Everyone signs in once more after upgrading.
- **A password for every workspace member.** Someone who signs in only by emailed link sets a
  password when they create their first workspace or accept an invitation. New passwords are
  typed twice and show a strength meter. Sign-in links keep working.
- **Sign out of all devices** in Settings, Personal, Security.

### Platform

- Releases publish through npm trusted publishing only; the npm token is gone. Each release
  gets a project release `vX.Y.Z` from this changelog, and each package its tag and release
  from its own CHANGELOG.

## 0.1.0 (24 November 2026), the first public release

### What ships

- **`codevibe-sign`** (Apache-2.0): the API client, PDF tools, core rules and React components
  behind one install with subpath imports, and a command line: `verify`, `inspect`, `keygen`,
  `hash` and `api-key`. It contains no AGPL code and does not depend on the server.
- **`@codevibe_technology/sign-server`** (AGPL-3.0-only): the HTTP API and runtime, with its own
  `codevibe-sign-server` command (`start` and `start --memory`), the Docker image and the
  `deploy/` set-up for the whole web app.
- **The libraries** `sign-core`, `sign-pdf`, `sign-client`, `sign-react`, `sign-templates` and
  `sign-aadhaar` (Apache-2.0). The server and the web app use `sign-aadhaar` for Aadhaar eSign
  through Leegality.
- **Workspaces** in the server: envelopes, API keys and webhooks belong to a workspace, each
  with its own mail templates, sender details and time zone for signed documents.
- **Webhooks** with a delivery log, test deliveries and redelivery.

### Aadhaar eSign

- A sender can ask one signer, who signs last, to sign with Aadhaar eSign through Leegality.
  The signer confirms with an Aadhaar OTP; the provider's signed file is kept byte for byte,
  the seal is added after it, and the signing certificate is a separate sealed PDF.
- On sign.codevibe.in each completed eSign is paid with prepaid credits, and an eSign that is
  not completed costs nothing. On Cloud you can connect your own Leegality account instead;
  self-hosted installs use their own account.

### Plans

- Plans belong to the account. Free has one workspace; Cloud has as many as you need under one
  subscription. Limits on members, templates and API requests count across your workspaces.
- Cloud is Rs 999 a month, or Rs 9,990 for a year, plus GST, with 25 members included and
  Rs 99 a month for each member beyond them. Each term is paid up front with a GST tax invoice;
  nothing is charged automatically.
- Self-hosting stays free and unlimited. Installation help is Rs 1,999 plus GST.

### In the API

- **Templates:** `GET`, `POST`, `PATCH` and `DELETE /v1/templates`, and
  `POST /v1/templates/{templateId}/envelopes` to send from a template with a person for each role.
- **Public verification:** `POST /v1/verify` and `GET /v1/verify/{sha256}` check a sealed PDF with
  no API key, limited per client address.
- **Versioning:** every `/v1` answer carries `Codevibe-Api-Version: 1`; deprecations will come
  with `Deprecation` and `Sunset` headers at least six months apart.

### In the web app

- Workspace addresses you choose at sign-up and can change; old links redirect.
- A time zone per workspace for the dates on signed documents and in emails.
- Sign-in by password or by email link, and people are called by their name.
- A public record page for each completed envelope, reached from the QR code on the certificate
  or the verify page, and switchable off per envelope or per workspace.
- A warning when a signature or initials field covers page text.
- Guided signing: one button reads Start, then Next, and Finish when nothing is left, with a
  progress bar; a signature saved on an earlier visit is reused.
- In the field placer a field starts on "This page only"; "Show on pages" puts it on all pages
  or specific pages.
- Light theme by default in the app and the docs.
- Uploading a PDF that already carries digital signatures is refused with a message to upload
  the unsigned original, since signing it again here would remove them.

### Stronger evidence

- Seals can carry an RFC 3161 timestamp (PAdES B-T) through `SEAL_TSA_URL`.
- The seal is a certification signature (DocMDP P=1, no changes allowed) when it is the first
  signature in the file.
- Seal certificates issued by a private root or a CA are supported; weak keys (RSA under 2048
  bits) and SHA-1 or MD5 certificates are refused.
- `verify(bytes, { trust })` passes only a file with exactly one intact signature that covers
  every byte and was made with a certificate you trust.
- Each drawn signature is captioned with the signer's name and signing time.
- Names, titles and field text in Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil,
  Telugu, Kannada, Malayalam and Arabic (including Urdu) are shaped and drawn with bundled
  Noto Sans fonts (SIL Open Font License), and typed signatures fall back to faces for these
  scripts.
- The signing certificate is one compact page: document, envelope, sender, each signer with
  masked contact, method and time, the fingerprint, and a QR code to the record page with
  "Signing certificate provided by:" and the logo under it. The QR code is also a link in PDF
  readers; IP addresses, the record address and the event list are not printed in the file.

### Safer by default

- **Breaking, before 1.0:** a recipient with an email address signs with a six-digit email code
  unless you choose `email_link`, so a forwarded link alone is no longer enough to sign.
- PDFs that already carry digital signatures are refused instead of having those signatures
  silently removed.
- Until a recipient has entered their code, the signing session shows no documents, fields or
  values, and the email address is masked.
- Limits on one-time codes per recipient, API keys stored as SHA-256 hashes, webhook targets
  limited to public HTTPS hosts, uploads parsed in a worker under limits, and every log line
  redacted.
- **Breaking, before 1.0:** envelope and document JSON no longer carries the internal `fileKey`.

### Platform

- Node 22 or later. Node 20 has reached end of life; CI runs on Node 22 and 24.
- CI can also be started by hand from the Actions tab, to check `main` without a new commit.
- CommonJS projects get correct types (`.d.cts` for `require`).
- Releases are published from GitHub Actions through npm trusted publishing, so each one carries
  a provenance statement.
- Contributors sign a contributor licence agreement (individual or corporate), checked on every
  pull request.
- The README, package and docs images are rendered from HTML in `.github/assets/src` with
  `pnpm assets:build`, from screenshots of the app with sample data.
- The README shows the current app: a new banner and demo, the plans, Aadhaar eSign, and the
  verify page with the published seal certificate. The package banners share one style.
- The home page share card uses the hero's headline and claims in Space Grotesk and Inter, with
  the current dashboard.
- The docs share card is redrawn in the light style of the site.

---

<p align="center">
  Built and maintained by <a href="https://codevibe.in?utm_source=github&utm_medium=changelog&utm_campaign=codevibe-sign&utm_content=built-by"><b>Codevibe</b></a>, a software development agency in Gurugram, India ·
  <a href="https://sign.codevibe.in?utm_source=github&utm_medium=changelog&utm_campaign=codevibe-sign&utm_content=footer">sign.codevibe.in</a>
</p>
