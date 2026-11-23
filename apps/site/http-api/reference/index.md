---
title: "API reference"
description: "Every route of the Codevibe Sign HTTP API, grouped by resource, with examples in curl, Node.js, Python and Go."
pageClass: api-page
aside: false
outline: false
---

<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->

# API reference

The Codevibe Sign API is organised around envelopes. It takes and returns JSON, uses standard HTTP status codes, and authenticates your backend with an API key. Version 1 lives under `/v1`.

<div class="api-base">
<p><span class="api-base__label">Cloud</span><code>https://sign.codevibe.in/api</code></p>
<p><span class="api-base__label">Self-hosted</span><code>https://&lt;your server&gt;</code></p>
</div>

New here? Start with the [quickstart](/http-api/quickstart), then read [authentication](/http-api/authentication) and [errors](/http-api/errors).

## Envelopes {#envelopes}

An envelope is one signing job: its documents, the people who act on them, the fields they fill and where it stands.

<ul class="api-index">
<li><a href="/docs/http-api/reference/envelopes.html#list-envelopes"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes</code><span>List envelopes</span></a></li>
<li><a href="/docs/http-api/reference/envelopes.html#create-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes</code><span>Create an envelope</span></a></li>
<li><a href="/docs/http-api/reference/envelopes.html#get-envelope"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}</code><span>Get an envelope</span></a></li>
<li><a href="/docs/http-api/reference/envelopes.html#update-envelope"><span class="api-method" data-method="patch">PATCH</span><code>/v1/envelopes/{id}</code><span>Change a draft</span></a></li>
<li><a href="/docs/http-api/reference/envelopes.html#send-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/send</code><span>Send a draft</span></a></li>
<li><a href="/docs/http-api/reference/envelopes.html#void-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/void</code><span>Withdraw an envelope</span></a></li>
<li><a href="/docs/http-api/reference/envelopes.html#recall-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/recall</code><span>Recall a sent envelope to edit it</span></a></li>
<li><a href="/docs/http-api/reference/envelopes.html#revise-envelope"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/revise</code><span>Revise a declined envelope</span></a></li>
</ul>

## Recipients {#recipients}

The people on an envelope.

<ul class="api-index">
<li><a href="/docs/http-api/reference/recipients.html#remind-recipients"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/remind</code><span>Remind recipients</span></a></li>
<li><a href="/docs/http-api/reference/recipients.html#share-signing-link"><span class="api-method" data-method="post">POST</span><code>/v1/envelopes/{id}/recipients/{recipientId}/link</code><span>Get a signing link to pass on yourself</span></a></li>
<li><a href="/docs/http-api/reference/recipients.html#correct-recipient"><span class="api-method" data-method="patch">PATCH</span><code>/v1/envelopes/{id}/recipients/{recipientId}</code><span>Correct a recipient who has not acted</span></a></li>
</ul>

## Documents {#documents}

The PDFs of an envelope: replace a draft's file, download the original or the sealed copy, and check the seal.

<ul class="api-index">
<li><a href="/docs/http-api/reference/documents.html#download-document"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/documents/{docId}</code><span>Download a PDF</span></a></li>
<li><a href="/docs/http-api/reference/documents.html#replace-document"><span class="api-method" data-method="put">PUT</span><code>/v1/envelopes/{id}/documents/{docId}</code><span>Replace a draft's document</span></a></li>
<li><a href="/docs/http-api/reference/documents.html#verify-document"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/documents/{docId}/verification</code><span>Verify the sealed PDF</span></a></li>
</ul>

## Audit trail {#audit-trail}

The hash-chained audit log of an envelope and the signing certificate built from it.

<ul class="api-index">
<li><a href="/docs/http-api/reference/audit-trail.html#list-envelope-events"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/events</code><span>Audit log</span></a></li>
<li><a href="/docs/http-api/reference/audit-trail.html#get-certificate"><span class="api-method" data-method="get">GET</span><code>/v1/envelopes/{id}/certificate</code><span>Signing certificate</span></a></li>
</ul>

## Signing {#signing}

What the recipient's browser calls.

<ul class="api-index">
<li><a href="/docs/http-api/reference/signing.html#get-signing-receipt"><span class="api-method" data-method="get">GET</span><code>/v1/sign/receipt</code><span>Follow the envelope after signing</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#get-receipt-document"><span class="api-method" data-method="get">GET</span><code>/v1/sign/receipt/documents/{docId}</code><span>Download your signed copy</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#get-emailed-copy"><span class="api-method" data-method="get">GET</span><code>/v1/sign/copy/{docId}</code><span>Download a signed copy from its email link</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#get-signing-session"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}</code><span>Open a signing session</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#get-signing-document"><span class="api-method" data-method="get">GET</span><code>/v1/sign/{token}/documents/{docId}</code><span>Download the original PDF</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#send-otp"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/otp</code><span>Send a one-time code</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#verify-otp"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/otp/verify</code><span>Verify the one-time code</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#mark-viewed"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/view</code><span>Record that the document was opened</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#submit-signature"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/submit</code><span>Sign or approve</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#decline-signature"><span class="api-method" data-method="post">POST</span><code>/v1/sign/{token}/decline</code><span>Decline</span></a></li>
<li><a href="/docs/http-api/reference/signing.html#open-signing-link"><span class="api-method" data-method="get">GET</span><code>/sign/{token}</code><span>Open a signing link</span></a></li>
</ul>

## Service {#service}

Health and this document.

<ul class="api-index">
<li><a href="/docs/http-api/reference/service.html#get-health"><span class="api-method" data-method="get">GET</span><code>/health</code><span>Health check</span></a></li>
<li><a href="/docs/http-api/reference/service.html#get-open-api"><span class="api-method" data-method="get">GET</span><code>/v1/openapi.json</code><span>This document</span></a></li>
</ul>

## Webhooks {#webhooks}

Events the server posts to your backend.

<ul class="api-index">
<li><a href="/docs/http-api/reference/webhooks.html#envelope-event"><span class="api-method" data-method="post">POST</span><code>your webhook URL</code><span>Envelope event</span></a></li>
<li><a href="/docs/http-api/reference/webhooks.html#test-event"><span class="api-method" data-method="post">POST</span><code>your webhook URL</code><span>Test event</span></a></li>
</ul>
