---
title: API keys and webhooks
description: Create and revoke API keys for a Codevibe Sign workspace, add webhook endpoints, choose their events, rotate the secret, send a test and read the delivery log.
---

# API keys and webhooks

These settings connect a workspace to your own software. Owners and admins manage them. For
the code side, see the [HTTP API](/http-api) and [Webhooks](/guides/webhooks).

## API keys

1. Open **Settings, API keys** and press **New API key**.
2. Give it a **Name** that says where it is used, then **Create key**.
3. Copy the key now. It is shown once; only its first characters are kept for you to
   recognise it.

The list shows each key's prefix, when it was created and when it was last used. **Revoke**
stops a key at once.

A key acts for its workspace: envelopes it creates belong to the workspace, not to a person.
On the Free plan, requests with a key count towards 100 a month across your workspaces; see
[Plans and pricing](/guides/pricing). Keep keys on your server, never in a browser or app;
see [Authentication](/http-api/authentication).

## Webhooks

A webhook endpoint is a URL on your server that Codevibe Sign calls when something happens,
so you do not have to keep asking.

1. Open **Settings, Webhooks** and press **Add an endpoint**.
2. Enter the URL. It must start with `https://`.
3. Add a **Description (optional)**, then choose **All events** or **Choose events**. The
   default is completed, declined and voided envelopes.
4. Copy the **signing secret**. It is shown once and lets your server check that a call is
   really from Codevibe Sign.

The events cover envelopes (created, updated, sent, completed, declined, expired, voided),
recipients (notified, reminded, viewed, authenticated, signed, approved, declined) and the
sealed document. The [webhooks reference](/http-api/reference/webhooks) lists each payload.

On an endpoint's page:

- **Send test event** sends a sample call now.
- **Deliveries** lists the last 30 days of calls with their answers. Filter **Failed** and
  resend one.
- **New secret** replaces the secret; update your server at the same time.
- **Turn off** pauses the endpoint, **Edit** changes it, and remove deletes it.

A failed call is tried again after 30 seconds, 2 and 10 minutes, then 30 minutes, 1, 3, 6 and
12 hours: about a day in all.

Webhooks are part of the Cloud plan (up to 10 endpoints) and self-hosted installs, not of
Free. A workspace has at most 20 endpoints.

## Next

[Email log](/admin/email-log)
