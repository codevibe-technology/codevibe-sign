---
title: Routing
description: Sequential and parallel routing decide who is invited when. Reminders and expiry are handled by one idempotent tick.
---

# Routing

Routing decides who is invited, and when.

## Sequential

The default. Signers and approvers act in `order`, lowest first. Only the unfinished
recipients with the lowest order are notified; the next order is invited when they have all
acted. Equal orders act together.

For example, an offer letter signed by the hiring manager (order 1), then the candidate
(order 2), with HR as a viewer: the candidate is invited only after the manager signs, and HR
receives the completed copy.

## Parallel

Every signer and approver is invited when the envelope is sent and can act in any order.

## Viewers

Viewers never act. They receive the completed copy once the envelope is complete.

## Reminders and expiry

`tick(envelope, now)` sends reminders that are due and expires the envelope once `expiresAt`
has passed. It is idempotent, so running it twice changes nothing. `nextTickAt(envelope)`
returns the next moment `tick` has work to do, so a scheduler can wake up exactly then.

Reminders follow the envelope's policy: the first `firstAfterDays` after a recipient was
notified, then every `everyDays`, at most `max` times. Setting `firstAfterDays` to 0 turns them
off.

## Declining and voiding

Any signer can decline, with a reason. The sender can void the envelope. Both end it for
everyone, and recipients who were already invited are told it was cancelled.
