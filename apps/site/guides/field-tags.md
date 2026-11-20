---
title: Place fields across pages and from text tags
description: Repeat a field on many pages, add initials to every page in one click, and let tags in your PDF place fields for you.
---

# Place fields across pages and from text tags

## Repeat a field on many pages

Select a placed field and pick **Repeat on pages**: this page only, all pages, every page
except the first, the last page, or **Pages…** with numbers such as `1, 3, 5-7`. Pages are
counted from 1 and must exist in the document. Each copy sits at the same spot relative to
its page, so it lands in the same place on A4 and Letter pages and on turned pages.

Copies form a group, shown as `×N pages` on each of them. After moving or resizing one,
**Apply to all in group** moves the others the same way; deleting offers **Delete this
one** or **Delete all**. In the envelope the copies are ordinary fields.

**Quick add** places, for the recipient you are placing for, initials in the bottom-right
corner of every page, or a signature on the last page of each document.

## Text tags

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

Tags are read from the PDF's text layer. A scanned PDF has none, so place its fields by
hand.

## Signing many boxes

The signer adopts a signature or initials once. Every other box of theirs then takes one
tap, still one box at a time, and **Fill all my initials** fills every initials box once
the initials are adopted.
