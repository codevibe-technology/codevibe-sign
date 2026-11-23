---
title: OTP and signing links
description: How signing links and one-time codes are generated, stored, limited and checked.
---

# OTP and signing links

## Signing links

Every recipient gets a private link with a random token.

- 32 random bytes, encoded as base64url.
- Only the SHA-256 of the token is stored. The token itself exists only in the email or SMS.
- A token belongs to one recipient on one envelope, expires and can be revoked.
- Checks compare hashes in constant time. Anything not shaped like a token
  (`isSigningTokenShape`) is refused before it is hashed.
- Opening the link (`GET /sign/<token>`) only reads. The server moves the token into an
  HttpOnly, SameSite=Strict cookie and redirects to a page URL without it, so the token does
  not stay in the browser history or leak in `Referer` headers. Mail scanners that open links
  in advance change nothing; the recipient counts as having viewed the document only when the
  signing page says so.

<!-- check:
declare const presentedToken: string;
-->

```ts check
import { createSigningToken, cryptoRandom, verifyToken } from '@codevibe_technology/sign-core';

const { token, tokenHash } = createSigningToken(cryptoRandom);
// Put `token` in the link. Store only `tokenHash`.

verifyToken(presentedToken, tokenHash); // true or false
```

## One-time codes

Recipients set to `email_otp` or `sms_otp` also confirm a code before they can sign.

Until the code has been checked, the signing API tells the link holder only what the
invitation email already said: the title and the recipient's name. The sender's message, the
documents, the fields and any prefilled values are left out and the email address is masked,
so a forwarded link shows nothing more than the forwarded email did.

| Rule           | Value                                            |
| -------------- | ------------------------------------------------ |
| Length         | 6 digits, drawn uniformly                        |
| Valid for      | 10 minutes                                       |
| Wrong attempts | 5, then the code is locked                       |
| Storage        | Salted hash only; the code itself is not kept    |
| Reuse          | A code that was accepted is never accepted again |
| Rate limits    | Per recipient and per IP address, in the server  |
| Codes per link | 5 per 15 minutes, 10 over the envelope's life    |
| Reissue        | Each new code replaces the previous one          |

<!-- check:
import type { OtpState } from '@codevibe_technology/sign-core';
declare const storedState: OtpState;
declare const codeFromUser: string;
-->

```ts check
import { createOtp, cryptoRandom, systemClock, verifyOtp } from '@codevibe_technology/sign-core';

const issued = createOtp(cryptoRandom, systemClock);
// Send issued.code to the recipient. Store issued.state.

const check = verifyOtp(storedState, codeFromUser, systemClock);
// Always save check.state, whether it passed or not.
if (!check.ok) throw check.error; // OTP_INVALID, OTP_EXPIRED or OTP_LOCKED
```

Saving the returned state on every call is what makes the attempt limit work. Save it only if
the stored state has not changed since you read it (the server compares a version number), or
two guesses sent at the same moment would both count as the first. After a code is accepted,
call `markAuthenticated` so the check is recorded in the audit log.

## Next

- [Send your first envelope in code](/guides/first-envelope)
- [Packages](/api)
