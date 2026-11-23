---
title: Place fields across pages and from text tags
description: Show a field on many pages, add initials to every page in one click, and let tags in your PDF place fields for you.
---

# Place fields across pages and from text tags

## Show a field on many pages

A field you place is on its own page only. To put it on more, select it and pick under
**Show on pages**:

- **This page only**: the field as placed. Picking it again takes the copies away.
- **All pages**: a copy on every page of the document.
- **Specific pages…**: type numbers such as `1, 3, 5-7`, then press Enter or **Apply**. The
  field ends up on exactly those pages, plus the page it is on.

The choice applies as soon as you pick it. Pages are counted from 1 and must exist in the
document; a number past the end is refused and nothing changes. Each copy sits at the same
spot relative to its page, so it lands in the same place on A4 and Letter pages and on
turned pages.

Copies form a group, shown as `×N pages` on each of them. After moving or resizing one,
**Apply to all in group** moves the others the same way; deleting offers **Delete this
one** or **Delete all**. In the envelope the copies are ordinary fields.

**Quick add** places, for the recipient you are placing for, initials in the bottom-right
corner of every page, or a signature on the last page of each document.

## Text tags

::: v-pre

Write tags in your document before you export it to PDF, and the send flow offers **Place
fields from tags (found N)**:

| Tag               | Field       |
| ----------------- | ----------- |
| `{{signature:1}}` | Signature   |
| `{{initials:1}}`  | Initials    |
| `{{date:1}}`      | Date signed |
| `{{name:1}}`      | Name        |
| `{{text:1}}`      | Text        |
| `{{checkbox:1}}`  | Checkbox    |

The number is the recipient's place in the signing order: `1` for the first signer or
approver, `2` for the second. A field starts at the tag's left edge, centred on its line,
in the type's usual size; tags for a number nobody has are reported and skipped. Spaces
inside the braces are allowed and case does not matter. The tag text stays in the PDF, so
set it in white or a tiny font if it should not show.

:::

Tags are read from the PDF's text layer. A scanned PDF has none, so place its fields by
hand.

## Signing many boxes

The signer presses **Start** and is taken to each field in turn. On a signature box the
same button reads **Sign**; the signature is adopted once, and every other box of theirs
then takes one tap, still one box at a time. **Fill all my initials** fills every initials
box once the initials are adopted. When nothing is left, the button becomes **Finish**.

## Next

- [Templates in the app](/app/templates)
- [Team and roles](/admin/team-and-roles)
