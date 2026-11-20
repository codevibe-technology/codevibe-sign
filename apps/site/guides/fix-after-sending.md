---
title: Fix an envelope after sending
description: Pass a signing link on yourself, correct a recipient, recall an envelope to edit it, or revise one that was declined.
---

# Fix an envelope after sending

Once an envelope is sent its documents and fields are fixed, so the signatures mean
something. Four calls cover the mistakes people make anyway. Each one is recorded in the
audit trail with who made it, and fires its webhook like any other event.

## A recipient does not get the email

```
POST /v1/envelopes/:id/recipients/:recipientId/link
```

Returns a fresh signing link for a recipient whose turn it is, to send them yourself, for
example on WhatsApp. No email goes out. Their earlier links stop working, so only the newest
one does, and a one-time code still applies if they sign with one. The link is in the
response only: the server keeps its hash, never the link, and the event
`recipient.link_shared` names who took it. At most 5 links per recipient per hour; the
request may not carry an `Idempotency-Key`, so the link is never replayed.

## A name or address is wrong

```
PATCH /v1/envelopes/:id/recipients/:recipientId
{ "email": "asha.rao@example.com" }
```

Changes the name, email or phone of someone who has not signed, approved or declined. Role,
order and fields stay, and their earlier links stop working. When it is their turn and the
address changed, the new address is invited at once; a name change sends nothing unless you
add `"resend": true`. `recipient.corrected` keeps the old and new values. Someone who has
acted cannot be changed: recall the envelope instead.

## The document or the fields are wrong

```
POST /v1/envelopes/:id/recall
{ "note": "The joining date was wrong" }
```

Voids the envelope with the reason "Recalled to correct" (everyone already invited is told)
and returns `{ draft, recalled }`: a new draft with the same original files, recipients,
fields, title, message and reminders, and an expiry of the same length from now. Signatures
already given are not carried over, so everyone signs again. The old envelope records
`envelope.recalled` with `replacementId`; the draft's `envelope.created` has `recalledFrom`.

## Someone declined

```
POST /v1/envelopes/:id/revise
```

For a declined envelope only. It stays declined and records `envelope.revised`; the response
is `{ draft, declined }`, and the draft's `envelope.created` has `revisedFrom`. Before sending
the draft, set `changeNote` to tell recipients what changed. It appears as "What changed: …"
in the invitation and on the signing page:

```
PATCH /v1/envelopes/:draftId
{ "changeNote": "The notice period is now 30 days." }
```

To send a new version of a file, replace it on the draft:

```
PUT /v1/envelopes/:draftId/documents/:docId
{ "name": "offer-v2.pdf", "content": "<base64>" }
```

Fields stay where they are when their page still exists and they fit on it. The others are
moved onto the nearest page and listed in `movedFields`, so you can check them before you
send. Everyone signs the revised envelope again.

## Who is named

Events record who acted as `data.by`: the `actorName` of the caller's `Principal` when your
`authenticate` sets one (for example the signed-in user's name), otherwise the API key id.
