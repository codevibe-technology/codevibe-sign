---
title: Aadhaar eSign with Leegality
description: Ask a signer to sign with Aadhaar eSign in Codevibe Sign, through the install's Leegality account with prepaid credits or through your own, and see what the signed file contains.
---

# Aadhaar eSign with Leegality

Use Aadhaar eSign where a law asks for a document to be signed in the statutory sense
(IT Act s.3A). For offer letters, policies and most business documents the built-in signature
is usually enough; see [Legal](/legal).

Aadhaar eSign is built into the web app and the server, and follows Leegality's standard
process. The sender picks it for a signer, the signer confirms with an Aadhaar OTP on
Leegality's page, and Leegality draws the signature where the sender placed the optional
Aadhaar seal position, or where your Leegality workflow says. The signed file comes back with
the Aadhaar signature and then the Codevibe Sign seal, and the certificate and audit trail come
as a separate PDF.

## Send a document for Aadhaar eSign

In the send flow, choose **Aadhaar eSign** under Identity check for the signer. The app shows
the price of one eSign and your credit balance before you send.

The first version keeps to four rules, and the send flow points at the field that breaks one:

- one signer in an envelope uses Aadhaar eSign;
- the envelope has one document;
- that signer acts last, after everyone else has signed or approved;
- the signer has an email address or a 10-digit Indian mobile number.

The reason for "one" and "last" is in [what the parties receive](#what-the-parties-receive).

### The signer fills in nothing

An Aadhaar eSign signer has no fields to fill in Codevibe Sign. The file Leegality signs is
exactly what you approved: the document, with the fields of the signers before them filled in
and flattened, and nothing added for the Aadhaar signer. Put any date, text or checkbox you
need on an earlier signer; one given to the Aadhaar signer is refused with a message saying
what to change.

### Choose where the signature goes

There are two ways, and you can use either per envelope.

**Place the Aadhaar seal position.** In the **Fields** step, pick the Aadhaar signer. The tray
offers one item, **Aadhaar seal position**, and the quick add **Aadhaar seal on last page**.
Drag the box where the Aadhaar signature should appear and resize it; its panel says
"Position only. Leegality draws the Aadhaar signature here; nothing is added to the file." It
is optional and there is at most one: once placed, the tray item is greyed out, and the quick
add moves the box instead of adding a second one. Nothing is drawn for it in any PDF. The box
works only when the Leegality account in use has a V4 workflow (see
[Set up a V4 workflow](#set-up-a-v4-workflow-for-the-seal-position)); the **Fields** and
**Review** steps say which applies.

**Leave it to the workflow.** Without a box, or without a V4 workflow, Leegality places the
signature where its workflow says (see [Set the signature position](#set-the-signature-position)).
The note in **Recipients**, **Fields** and **Review** says so.

### Set the signature position

Leegality's create-request API v3.0, which Codevibe Sign uses when there is no seal position,
has no field for the position of a signature: it comes from the workflow
([Create an e-signing request](https://knowledge.leegality.com/document-execution/api/create-an-e-signing-request),
[Signature coordinates](https://knowledge.leegality.com/document-execution/leegality-features/signature-coordinate)).
Without coordinates, Leegality puts the signature at the bottom left of every page.

To choose the place, in the Leegality dashboard:

1. Open the workflow whose ID is in **Settings, Aadhaar eSign** (with prepaid credits, the
   install's operator keeps this workflow).
2. In the invitee's signature settings, choose **Custom Coordinates**, click where the
   signature should go on the page and pick the invitee in the signature box.
3. Choose **All** to put it on every page, or leave it on the page you clicked. **Clear
   Coordinates** goes back to the default.
4. Save and publish the workflow. Requests started after that use the new position.

The position is fixed per workflow, so documents with the same layout work best with one
workflow. Leave room for it in your document, for example an empty "Signature" area at the
foot of the last page.

### Set up a V4 workflow for the seal position

Only Leegality's v4 Pack API takes a position per request: each signer's `coordinates[]`, with
an `appearances[]` entry per page holding `pageNo` (from 1) and a `rect`
(`x1Axis`, `y1Axis`, `x2Axis`, `y2Axis`)
([Send Pack for eSigning (Sync)](https://knowledge.leegality.com/document-execution/api/create-pack-sync)).
When an envelope has a seal position and a V4 workflow is set, Codevibe Sign sends it through
`POST /api/v4/pack/sync`; otherwise it uses v3.0 as before.

In the Leegality dashboard
([Create a v4 workflow](https://knowledge.leegality.com/document-execution/workflows/v4/create-a-workflow)):

1. Go to **Workflows**, open the **V4 Workflows** tab and click **+ New Workflow**. Name it,
   for example "Codevibe Sign Aadhaar eSign", and click **Confirm**.
2. **Create** stage: keep the one primary document with an empty PDF upload. Codevibe Sign
   sends the file with every request.
3. **Invite** stage: keep the one invitee as **Signer**, with Name, Email and Phone left
   blank, and choose **Aadhaar eSign** as its eSign type. Assign it the document.
4. In **Field Properties**
   ([Field properties](https://knowledge.leegality.com/document-execution/workflows/v4/setup-configuration/field-properties)),
   leave the document upload, the invitee details and the signature coordinates **editable**
   by the workflow runner, so a request can set them. Leegality's v4 API says a request may
   add a coordinate "if the workflow creator allows adding coordinates"; its documentation
   names no separate switch for it, so if a test request is refused, ask Leegality support to
   allow sender-added coordinates on the workflow.
5. **Finalise** stage: place a default signature coordinate if you like (it is used when a
   request has none), then click **Publish**.
6. Open the workflow's **⋮** menu and choose **Download API Payload**
   ([Download the v4 API payload](https://knowledge.leegality.com/document-execution/api/download-v4-api-payload)).
   The file holds the full workflow ID (the dashboard shows only its first eight characters)
   and the IDs of the document, sub-document, signer and combination.
7. Give Codevibe Sign the file: paste it, or the full workflow ID in it, into **V4 workflow,
   for the Aadhaar seal position** under **Settings, Aadhaar eSign**, **Replace details**
   (your own account), or set `LEEGALITY_V4_PAYLOAD_FILE` or `LEEGALITY_V4_WORKFLOW_ID` (the
   install's account, see [Self-hosted](#self-hosted)). Only the IDs are kept. With only the
   workflow ID, Codevibe Sign makes new IDs for each request, which works when the workflow
   lets the runner add documents and invitees.

You do not set webhooks in the V4 workflow: Codevibe Sign sets the success and error webhook of
each request to `https://<your app>/api/v1/esign/webhooks/leegality` with version 4.0
([Webhook 4.0](https://knowledge.leegality.com/document-execution/api/webhooks-v4/webhook-v4-introduction)),
and the redirect URL to `https://<your app>/sign?esign=return`. A 4.0 webhook is checked with
the same Private Salt (its `mac` signs the document ID) and then with
[Check Pack Details](https://knowledge.leegality.com/document-execution/api/check-pack-details);
the signed file and Leegality's audit trail come from
[Download files](https://knowledge.leegality.com/document-execution/api/download-files). The
v3.0 workflow, with its webhook version 2.5, keeps working for envelopes without a box.

### Calibrate the coordinates

Leegality's v4 documentation does not say in which unit the rectangle is measured or from
which corner. Its only example is `350, 680, 550, 720` on page 1. Its earlier API described the
same rectangle as the lower-left and upper-right corners in whole numbers, which is PDF user
space: points (1/72 inch) from the bottom-left corner. Codevibe Sign uses that by default and
turns the box into it, taking the page's crop box and rotation into account (a box on a
landscape page rotated by 90 degrees lands where it was drawn). If one test shows otherwise,
change the setting; no code changes:

| Variable                      | Values                    | Default       |
| ----------------------------- | ------------------------- | ------------- |
| `LEEGALITY_COORDINATE_UNITS`  | `points`, `pixels@<dpi>`  | `points`      |
| `LEEGALITY_COORDINATE_ORIGIN` | `bottom-left`, `top-left` | `bottom-left` |

`bottom-left` measures in the unrotated page, as signature libraries do; `top-left` measures
the page as it is shown, y going down. The settings apply to every Leegality account of the
install, and **Settings, Aadhaar eSign** shows the one in use.

Do this once, in the sandbox, before you rely on it:

1. Make a one-page A4 PDF with a thin rectangle printed at 72 points from the left and 72
   points from the bottom, 200 by 64 points (or use any document with a clear mark near a
   corner).
2. Send it to yourself with Aadhaar eSign and place the Aadhaar seal position exactly over the
   mark, using the size fields of its panel.
3. Sign it in the sandbox and open the signed file.
4. If the seal sits on the mark, you are done. If it is mirrored top to bottom (near the top
   of the page), set `LEEGALITY_COORDINATE_ORIGIN=top-left`. If it is in the right corner but
   too small and too close to the corner, Leegality reads pixels: try
   `LEEGALITY_COORDINATE_UNITS=pixels@96` (then `pixels@150` or `pixels@300`). Restart and
   test again.
5. Try one landscape page too, if your documents have them.

## What the signer does

1. They open their signing link, agree to sign electronically and read the document. There is
   nothing to fill in or draw.
2. They choose **Continue to Aadhaar eSign** and are taken to Leegality's page. There they
   review the document and confirm with an OTP sent to the mobile number linked to their
   Aadhaar.
3. They come back to Codevibe Sign, which waits for Leegality's confirmation and then shows the
   thank-you page with **Signed document (Aadhaar eSign)** and **Certificate and audit trail**
   to download.

If the signer declines at Leegality, the envelope is declined. If the eSign fails or runs out of
time, nothing is signed and the signer can try again from the same link.

Codevibe Sign never sees or stores the Aadhaar number. It keeps what the signature itself
says: the signer's name on their eSign certificate, the authority that issued it (for example
Protean eGov Technologies, under the CCA) and the certificate's SHA-256. The name on the
certificate is the one shown everywhere; the name Leegality reports, which can come from the
workflow, is kept only as a note. When the certificate names someone other than the recipient
(beyond case, spacing or a middle initial), the audit trail records "Aadhaar name differs from
recipient name" and the envelope page shows it to the sender. The envelope still completes.

## What the parties receive

- **Signed document (Aadhaar eSign).** The file Leegality signed, kept byte for byte, with the
  Codevibe Sign seal added after it as one more signature. The seal is invisible and adds or
  changes no page, so the document has exactly the pages you sent.
- **Certificate and audit trail**, one sealed PDF named after the envelope, for example "Offer letter (certificate and audit trail).pdf": the signing certificate page (the envelope, the sender, every signer and how they
  signed, the name and issuer of the Aadhaar signer's eSign certificate and the time of the
  signature, the SHA-256 of the original and of the signed document, the record QR code), then
  every event of the audit trail.
- **Leegality's audit trail**, when Leegality hands it over: kept as further evidence, on the
  envelope page for the sender, and attached to the completed email when it is small.

The completed email carries the first two, as attachments or download links. The envelope page,
the thank-you page and the public record page offer them too; the public record page never
offers the signed document itself.

Nothing but another signature may follow an Aadhaar signature, which is why the certificate is
a separate file and the Aadhaar signer acts last: anything drawn after the Aadhaar signature
would break it.

If the provider's file forbids any further signature, Codevibe Sign does not force one. It keeps
the provider's file exactly as it came, records its SHA-256 in the audit trail, and says so when
the file is verified ("sealed by the eSign provider only").

An Aadhaar eSign started under the earlier flow, when Codevibe Sign put the certificate page in
the file before signing, keeps that page in its signed file. To give such an envelope the
standard files, void it and send it again.

### Verify it

Upload the file on the [verify page](/guides/verify-pdf), or use `POST /v1/verify`. The answer
names both signatures: the seal, and under "earlier signatures" the Aadhaar signature with the
signer's name and the issuing authority. A change to any byte breaks one or both.

In a PDF reader, such as Adobe Acrobat Reader, both signatures show as valid. The Aadhaar
signature shows that the revision it signed has not been changed; the only later change is the
seal, a signature added without touching any page. See
[The seal in PDF readers](/guides/seal-in-pdf-readers) for what readers trust by default.

## Two ways to pay for it

**Settings, Aadhaar eSign** is where the account owner chooses, once for all the workspaces on
their account. Admins of a workspace can see the choice but not change it.

### The install's account, with prepaid credits

This is the default on [sign.codevibe.in](https://sign.codevibe.in), on every plan. One
completed eSign uses one credit.

- Buy credits in packs from **Settings, Billing**. The price of one eSign is shown there, in
  the send flow and on the [pricing section](https://sign.codevibe.in/#pricing). See
  [Credits and billing](/guides/credits-and-billing).
- A credit is held when the signer starts, and used only when the eSign completes.
- A credit that was held is returned when the signer declines, the eSign fails or it runs out of
  time.
- With no credit left, an envelope with an Aadhaar signer cannot be sent, and a signer who
  arrives later is told the document is not available right now while the sender sees why on
  the envelope.
- Credits do not expire. This is the current policy. They stay usable if the account moves
  from Cloud to Free; credits bought while on Free are at the Free price.

### Your own Leegality account

Available on the Cloud plan and on self-hosted installs. Leegality bills you directly and no
credits are used.

1. In the Leegality dashboard, publish a workflow with Aadhaar eSign as the invitee's signature
   type and the signature position set (see [Set the signature position](#set-the-signature-position)).
   To let senders place the Aadhaar seal position, also publish a V4 workflow (see
   [Set up a V4 workflow](#set-up-a-v4-workflow-for-the-seal-position)).
2. In that workflow, under the invitee's custom URLs and webhooks, set the Webhook and Error
   Webhook to `https://<your app>/api/v1/esign/webhooks/leegality` (version 2.5) and the
   Redirect URL to `https://<your app>/sign?esign=return`. The settings page shows both with a
   copy button.
3. In **Settings, Aadhaar eSign**, choose **Use your own Leegality account** and enter the
   Auth Token, the Private Salt, the Workflow ID and whether they belong to the sandbox or to
   production. Optionally paste the V4 workflow's downloaded API payload; the page then says
   "Aadhaar seal position: on".
4. **Test connection** makes one read-only call to Leegality and says whether the details work.

The credentials are encrypted before they are stored and are never shown again; the page shows
only the last four characters of the token. They cannot be changed while an eSign is in
progress, because its callback is checked with the account it started on.

A workspace that moves from Cloud to Free keeps its saved account, but it is not used: sending
with Aadhaar eSign is refused until the workspace is back on Cloud or switches to credits.

### Test mode

While the operator runs on test payment keys and the Leegality sandbox, the app shows "Test
mode" wherever something can be bought. Sandbox eSigns are not legally valid signatures.

### Self-hosted

A self-hosted install has no credits and no billing pages. Each workspace enters its own
Leegality account as above, or the operator sets one account for the whole install in the
environment (`LEEGALITY_API_KEY`, `LEEGALITY_PRIVATE_SALT`, `LEEGALITY_WORKFLOW_ID`,
`LEEGALITY_BASE_URL`). `LEEGALITY_BASE_URL` is `https://app1.leegality.com/api` for production;
left unset, the sandbox is used. If you add a custom header to the workflow's webhooks in
Leegality, set the same one in `LEEGALITY_WEBHOOK_HEADER_NAME` and
`LEEGALITY_WEBHOOK_HEADER_VALUE`, and a webhook without it is refused. For the Aadhaar seal
position, set `LEEGALITY_V4_PAYLOAD_FILE` to the path of the V4 workflow's downloaded API
payload (or `LEEGALITY_V4_WORKFLOW_ID` to its full ID), and `LEEGALITY_COORDINATE_UNITS` and
`LEEGALITY_COORDINATE_ORIGIN` if the [calibration](#calibrate-the-coordinates) asks for it. A
malformed value is listed among the billing problems and the box is then not sent. See
[Self-host with Docker](/getting-started/docker) and section 12 of the deploy guide in the
repository.

## Over the HTTP API

Create the envelope with `auth: "aadhaar"` on the signer. The same four rules apply and a
broken one answers `400` with the issue. A workspace that cannot use Aadhaar eSign right now
answers `409` with [`ESIGN_UNAVAILABLE`](/http-api/errors#esign-unavailable) and a
`details.reason` such as `not_configured` or `no_credits`.

Audit events to expect: `recipient.esign_started`, then `recipient.signed` with
`data.method: "aadhaar_esign"`, or `recipient.esign_failed` with `data.reason`. The recipient
carries `esign: { provider, status }`.

Give the Aadhaar signer no fields, or one `aadhaar` field: the Aadhaar seal position, a `page`
and `rect` in PDF points like any field, which takes no value. A second `aadhaar` field is
refused with `400` ("can have one Aadhaar seal position; remove this extra box"). For older
clients, `signature` and `initials` fields given to that signer are dropped when the envelope
is sent; any other field for them is refused with `400`. The signed document is downloaded with `version=sealed`, the certificate
and audit trail with `version=certificate`, and Leegality's audit trail with
`version=provider-audit-trail`. The `recipient.signed` event carries `signerName` from the
eSign certificate and, when it differs, `providerSignerName`; a name that is not the
recipient's adds a `recipient.esign_name_differs` event.

If you run `@codevibe_technology/sign-server` yourself, pass a provider in the `esign` option;
see the [server reference](/api/server).

## Use the library in your own backend

Everything above happens inside the server and the web app. The same package also works on
its own, when you run the signing flow yourself.

### 1. Set up the Leegality workflow

Leegality's API runs a published workflow, and several settings live only there. In the
Leegality dashboard, for the workflow you will pass as `profileId`:

- choose Aadhaar eSign as the signature type for the invitee;
- set the signature position with custom coordinates (create one workflow per layout if you
  need several);
- under the invitee's custom URLs and webhooks, set the Webhook and Error Webhook to your
  callback URL, choose webhook version 2.5, and set the Redirect URL.

### 2. Create the provider

```sh
pnpm add @codevibe_technology/sign-aadhaar @codevibe_technology/sign-core
```

```ts check
import { createLeegalityProvider } from '@codevibe_technology/sign-aadhaar';

const esign = createLeegalityProvider({
  environment: 'sandbox',
  authToken: process.env.LEEGALITY_API_KEY!,
  privateSalt: process.env.LEEGALITY_PRIVATE_SALT!,
  profileId: process.env.LEEGALITY_WORKFLOW_ID!,
});
```

Start with `sandbox` and switch to `production` when you go live.

To place the signature per request, add a V4 workflow. A request that carries
`signaturePositions` then goes through the v4 Pack API; one without them uses `profileId` and
v3.0 as above:

<!-- check:
import { createLeegalityProvider, leegalityV4WorkflowFromPayload } from '@codevibe_technology/sign-aadhaar';
declare const downloadedPayload: string;
-->

```ts check
const placed = createLeegalityProvider({
  environment: 'sandbox',
  authToken: process.env.LEEGALITY_API_KEY!,
  privateSalt: process.env.LEEGALITY_PRIVATE_SALT!,
  profileId: process.env.LEEGALITY_WORKFLOW_ID!,
  v4: leegalityV4WorkflowFromPayload(downloadedPayload),
  coordinates: { units: 'points', origin: 'bottom-left' },
});
```

Each position is `{ page, rect, pageBox }`: the zero-based page, the box in PDF points from the
top-left of the page as shown, and the page's crop box and `/Rotate` (`boxes` from `inspectPdf`
in the PDF package gives them). `toLeegalityRect` shows the rectangle that is sent.

### 3. Create a request and send the signer

<!-- check:
import { createLeegalityProvider } from '@codevibe_technology/sign-aadhaar';
import type { Envelope } from '@codevibe_technology/sign-core';
declare const esign: ReturnType<typeof createLeegalityProvider>;
declare const envelope: Envelope;
declare const pdf: Uint8Array;
-->

```ts check
const { providerRef, signUrl } = await esign.createRequest({
  envelopeId: envelope.id,
  recipient: { name: 'Asha Rao', email: 'asha@example.com' },
  documentBytes: pdf,
  documentName: 'Appointment letter.pdf',
  callbackUrl: 'https://sign.example.com/hooks/leegality',
  redirectUrl: 'https://sign.example.com/done',
});
```

Store `providerRef` with the recipient and send them to `signUrl`. They review the document and
sign with an Aadhaar OTP on Leegality's page.

### 4. Handle the webhook

Pass the raw body exactly as received:

<!-- check:
import { createLeegalityProvider } from '@codevibe_technology/sign-aadhaar';
declare const esign: ReturnType<typeof createLeegalityProvider>;
declare const request: { headers: Headers };
declare const rawBody: string;
-->

```ts check
const event = await esign.parseWebhook(request.headers, rawBody);

if (event?.status === 'signed') {
  const signed = await esign.fetchSignedDocument(event.providerRef);
  const trail = await esign.fetchAuditTrail?.(event.providerRef);
  // Store both and record the signature in the envelope's audit trail.
  // To seal it afterwards use countersign() from sign-pdf, which keeps every signed byte.
}
```

`parseWebhook` throws `SignError('WEBHOOK_INVALID')` for a body it cannot verify, and returns
`null` for a verified callback that does not change the signer's status. By default it also
confirms each webhook with Leegality's status API, because the documented webhook signature
covers only the document id.

## Things to know

- With the v3.0 request, signature positions, callback URL and redirect URL come from the
  workflow; that API does not take them. With a V4 workflow, the request sets all three, and
  the provider reference is `v4:<packId>:<documentId>`.
- Webhooks carry no signing time. Record the time you received the verified event.
- Provider failures throw `PROVIDER_ERROR` with `details.reason` and `details.retryable`;
  HTTP 429 throws `RATE_LIMITED`. Errors never contain the document or your credentials.

The full list of options is in the [API reference](/api/aadhaar).

## Other providers

Leegality is the only provider today. eMudhra is planned as the second one. Both sit behind the
`EsignProvider` interface (`createRequest`, `parseWebhook`, `fetchSignedDocument`, and
optionally `fetchAuditTrail`), so you can
add another provider yourself. Pull requests are welcome.

## Next

- [Aadhaar eSign settings](/admin/aadhaar-esign)
- [Credits and billing](/guides/credits-and-billing)
