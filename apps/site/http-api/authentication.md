---
title: Authentication
description: How your backend authenticates with an API key, how signers are authorised by the token in their link, and how to keep both safe.
---

# Authentication

The API has two kinds of caller and two kinds of credential. Your backend uses an **API key**.
The person signing uses the **signing token** from their link, which their browser sends for
them.

## API keys

Every `/v1/envelopes` route needs a sender API key as a bearer token:

```sh
curl https://sign.codevibe.in/api/v1/envelopes \
  -H "Authorization: Bearer $SIGN_API_KEY"
```

| Where you run it | Where keys come from                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud            | **Settings > API keys** in your workspace. A key starts with `cvs_`, is shown once, and can be revoked there. It records when it was last used. |
| Self-hosted      | The `API_KEYS` variable, comma separated, at least 16 characters each. `npx codevibe-sign api-key` prints a new random one.                     |
| Local sandbox    | `npx @codevibe_technology/sign-server start --memory` prints a fresh key every time it starts.                                                  |

A key acts for its workspace. It sees and changes only that workspace's envelopes: an id from
another workspace answers `404 ENVELOPE_NOT_FOUND`, exactly like an id that does not exist. A
read-only credential may call `GET` routes only and gets `403 FORBIDDEN` for anything else.

A missing or unknown key gets `401 UNAUTHORIZED`:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Send an API key as Authorization: Bearer <key>" } }
```

### Keep keys secret

- Call the API from your server only. Never put a key in a browser, a mobile app or a public
  repository. The API sends no CORS headers, so browsers on other sites cannot use a key anyway.
- Use one key per system, named after it, so you can revoke one without touching the others.
- Rotate by creating the new key, deploying it, then revoking the old one.

## Signing tokens

Recipients never get an API key. Each one gets a signing link,
`https://<server>/sign/<token>`, where the token is 43 random characters. The signing routes,
`/v1/sign/<token>/...`, are authorised by that token alone, and only for that recipient.

- When the recipient must enter a one-time code, `POST /v1/sign/<token>/otp/verify` returns a
  session. Send it as the `X-Sign-Session` header (browsers get it as an HttpOnly cookie). It
  lasts 30 minutes.
- When the link goes through the server's `GET /sign/<token>`, the token moves into an HttpOnly
  `cvsign_link` cookie and your signing page calls `/v1/sign/link/...` from the same origin, so
  the token never sits in the page's address.
- After signing, `submit` returns a receipt that lets the signer follow the envelope and
  download their copy for 7 days.

Treat a signing link like a password: anyone holding it can act as that recipient.
[OTP and signing links](/concepts/otp-and-links) explains the whole flow.

## Public routes

`GET /health` and `GET /v1/openapi.json` need no credentials.
