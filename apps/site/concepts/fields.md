---
title: Fields and coordinates
description: Field types, how they are placed on a page in PDF points with a top-left origin, and how submitted values are checked.
---

# Fields and coordinates

A field is a box on one page of one document, owned by one recipient.

## Types

| Type          | Value                                                   |
| ------------- | ------------------------------------------------------- |
| `signature`   | A PNG image, at most 512 KB.                            |
| `initials`    | A PNG image, at most 512 KB.                            |
| `date_signed` | An ISO date. Filled in automatically when left empty.   |
| `name`        | Text. Filled with the recipient's name when left empty. |
| `text`        | Text, at most 1000 characters.                          |
| `checkbox`    | `'true'` or `'false'`.                                  |
| `aadhaar`     | None. Where an Aadhaar eSign signer signs; see below.   |

Fields are required by default. Only signers and approvers can own fields.

A signer with `auth: 'aadhaar'` has exactly one `aadhaar` field, required, and no
`signature` or `initials` fields: they sign the whole file at the eSign provider and draw
nothing. Nobody else can have an `aadhaar` field. See
[Aadhaar eSign with Leegality](/guides/aadhaar-leegality#place-the-aadhaar-esign-box).

## Coordinates

Positions are in **PDF points** (1/72 inch) with the origin at the **top-left** of the page:

```ts
{
  page: 0,          // zero-based page index
  rect: { x: 72, y: 640, width: 180, height: 48 },
}
```

- `x` is measured from the left edge, `y` from the top edge.
- An A4 page is about 595 × 842 points; US Letter is 612 × 792.
- When the document has `pageSizes`, every field is checked to sit fully inside its page.

The top-left origin matches screen coordinates, so a placement UI can store what the sender
drags without flipping the axis. Conversion to the PDF's own bottom-left origin happens only when
values are drawn.

## Submitted values

When a recipient submits, each value is checked against its field type. Signature and initials
images may be raw base64 or a `data:image/png;base64,` URL, and are re-encoded before they are
drawn. A recipient can only fill their own fields (`FIELD_NOT_YOURS`), and every required field
must be filled (`REQUIRED_FIELDS_MISSING`).

## Next

[Audit chain](/concepts/audit-chain)
