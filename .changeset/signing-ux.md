---
'@codevibe_technology/sign-react': minor
---

The signing view guides the signer: one button reads Start, then Next, and Sign or Initial
on a signature box, and Finish becomes the main button when nothing is left. It moves on by
itself after a signature, marks the current field with a flag, and shows progress as a bar.
Given a height, the pages scroll inside the view in both directions with the action bar
pinned under them; zoomed in, a vertical scroll is no longer swallowed and the page's left
edge can be reached. Empty signature boxes are shown at a size a finger can hit, a
signature saved on an earlier visit is adopted, and redoing a signature replaces it in
every box that used it. New labels: `start`, `next`, `guideFlag`, `documentRegion`,
`actions`, `reuseSignature`, `reuseInitials`.

In the field placer a field starts on "This page only". "Show on pages" offers this page,
all pages or specific pages and applies as it is picked; the choices "every page except the
first" and "last page" and the separate Repeat button are gone, so `RepeatChoice` is now
`'this' | 'all' | 'custom'` and the label `repeated` is replaced by `repeatChanged`, with
`pagesLabel` and `pagesHint` added. A field added by a click lands in the part of the page
on screen, clear of the fields already there, and the drag ghost is the size of the field.
`useFieldPlacement` gains `setFieldPages` and `pagesOf`; `formatPageList`, `choiceForPages`
and `freeRect` are exported.
