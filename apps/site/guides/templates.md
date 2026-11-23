---
title: Reuse a document with templates
description: Store a PDF with its roles and fields once as a template, then send it to new people with one API call, with values filled in for them.
---

# Reuse a document with templates

When you send the same document again and again, such as an offer letter or an NDA, store it
once as a **template**: the PDFs, the **roles** that act on them (Employee, HR), the fields
each role fills in, and the settings. Each new envelope then only needs the people.

Templates made in the dashboard and templates made with the API are the same templates. You
can design one in the editor and send it from your backend, or the other way round.

## Create a template

```ts check
import { readFile } from 'node:fs/promises';
import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

const template = await sign.templates.create({
  name: 'Offer letter',
  message: 'Welcome aboard. Please sign your offer.',
  documents: [{ key: 'offer', name: 'offer.pdf', content: await readFile('offer.pdf') }],
  roles: [
    { key: 'employee', name: 'Employee' },
    { key: 'hr', name: 'HR', type: 'viewer' },
  ],
  fields: [
    { role: 'employee', type: 'signature', page: 0, x: 72, y: 640, width: 180, height: 48 },
    {
      role: 'employee',
      type: 'text',
      label: 'Employee code',
      page: 0,
      x: 72,
      y: 600,
      width: 180,
      height: 20,
      required: false,
    },
  ],
});
```

A role is a slot, not a person. Its `type` is `signer`, `approver` or `viewer`, and its `auth`
says how the person will prove who they are (`email_otp` unless you say otherwise). Fields
name their role by its `key`, and boxes are in PDF points from the top-left corner of the page,
exactly as on an [envelope](/concepts/fields).

## Send an envelope from it

Say who takes each role, by role name or role id:

```ts check
import { createSignClient } from '@codevibe_technology/sign-client';

declare const sign: ReturnType<typeof createSignClient>;
declare const templateId: string;

const envelope = await sign.templates.createEnvelope(templateId, {
  roles: {
    Employee: { name: 'Asha Rao', email: 'asha@example.com' },
    HR: { name: 'HR Team', email: 'hr@example.com' },
  },
  prefill: { 'Employee code': 'E-1042' },
  metadata: { employeeId: 'E-1042' },
  send: true,
});

console.log(envelope.id, envelope.status); // "sent"
```

- Every role needs a person. A missing one is a `400 VALIDATION` error that names the role,
  such as `roles.HR`.
- `prefill` sets text fields before anyone signs, by the field's label or id. The recipient
  can still change the value.
- `title`, `message`, `reminders`, `expiresInDays` or `expiresAt` replace the template's for
  this one envelope.
- Without `send: true` you get a draft to look over and send later.

From here on it is an ordinary envelope: the same webhooks, the same audit trail, the same
sealed PDF. `metadata.templateId` says which template it came from. It has its own copy of
the PDFs, so changing or deleting the template later does not touch it.

## Change or delete a template

`PATCH /v1/templates/{templateId}` changes the name, message, settings, roles or fields. Roles
and fields are replaced as a whole when you send them; give a role its `id` to keep it. The
PDFs of a template cannot be changed: create a new template for a new version of the document.

`DELETE /v1/templates/{templateId}` removes the template and its stored PDFs for good.

## Good to know

- Send an `Idempotency-Key` with every create, so a retry never makes a second template or a
  second envelope. The Node.js client does this for you.
- Envelopes made from a template count towards the same per-minute limit as any other.
- A key only sees its own workspace's templates; another workspace's id answers
  `404 NOT_FOUND`.
- On [sign.codevibe.in](https://sign.codevibe.in) the Free plan has 2 active templates across
  your workspaces and bulk sends of up to 10 rows; Cloud has no template limit. See
  [Plans and pricing](/guides/pricing).

The [templates reference](/http-api/reference/templates) lists every field and error.

## Next

[Webhooks](/guides/webhooks)
