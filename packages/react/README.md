# @codevibe/sign-react

React components for electronic signatures: a signature pad (draw, type or upload), a
signing view for recipients and a field placer for senders. They read and write the
types from `@codevibe/sign-core` (`Field`, `FieldValue`, `Recipient`), so what the
placer emits and what the signing view submits go straight to the core workflow.

No CSS framework. Styling comes from one small stylesheet driven by `--cvs-*` custom
properties, with a light and a dark palette.

## Install

```sh
pnpm add @codevibe/sign-react @codevibe/sign-core
# To render PDFs with the built-in renderer:
pnpm add pdfjs-dist
```

React 18 or 19. `pdfjs-dist` is an optional peer dependency, loaded only when a document
is given as a `file`; pass your own `source` to render pages another way.

```ts
import '@codevibe/sign-react/styles.css';
```

## Usage

```tsx
import { FieldPlacer, SigningView, SignaturePad } from '@codevibe/sign-react';

// Sender: place fields for each signer.
<FieldPlacer
  documents={[{ id: doc.id, name: doc.name, file: pdfBytes }]}
  recipients={envelope.recipients}
  fields={fields}
  onChange={setFields}
  pdf={{ workerSrc }}
/>

// Recipient: fill and sign their own fields.
<SigningView
  documents={[{ id: doc.id, file: pdfUrl }]}
  fields={envelope.fields}
  recipient={me}
  onSubmit={(values) => api.submit(values)}
  onDecline={(reason) => api.decline(reason)}
/>

// Just the pad. Value is PNG base64 without the data URL prefix.
<SignaturePad value={png} onChange={setPng} aspectRatio={3} />
```

With pdf.js you usually need to tell it where its worker is. In Vite:

```ts
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
const pdf = { pdfjs, workerSrc };
```

Or skip pdf.js and supply a `source`: `{ pages: PageSize[]; renderPage(pageIndex, scale, signal) }`,
where `renderPage` resolves to a canvas, image or `ImageBitmap` drawn at `scale` device
pixels per PDF point.

## Coordinates

Every `Field.rect` is in PDF points (1/72 inch) measured from the top-left corner of the
page as displayed, which is the crop box with the page rotation applied (what pdf.js
reports at scale 1). Use `flipVertical(rect, pageSize)` to get the bottom-left origin
that PDF content streams use. Placed rects are rounded to 1/100 point.

## API

### Components

| Component      | Key props                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SignaturePad` | `value`, `onChange(png \| null)`, `modes`, `defaultMode`, `aspectRatio`, `fonts`, `colors`, `defaultText`, `upload`, `labels`                        |
| `SigningView`  | `documents`, `fields`, `recipient`, `onSubmit(values)`, `onDecline(reason)`, `initialValues`, `today`, `signaturePad`, `pdf`, `labels`               |
| `FieldPlacer`  | `documents`, `recipients`, `fields` or `defaultFields`, `onChange(fields)`, `fieldTypes`, `fieldSizes`, `snapThreshold`, `createId`, `pdf`, `labels` |

Every visible string comes from a `labels` prop with English defaults
(`defaultSignaturePadLabels`, `defaultSigningViewLabels`, `defaultFieldPlacerLabels`).

### Hooks

- `useSignaturePad(options)`: mode, strokes, undo and clear, typed text and font,
  upload, and `canvasProps` to spread on your own `<canvas>`.
- `useFieldPlacement(options)`: fields, selection, `addField`, `moveField`,
  `resizeField`, `nudgeField`, `updateField`, `removeField`. All rects in points.
- `usePdfSources(documents, pdfOptions)`: resolves documents to page sources.

### Helpers

`validateFieldValues`, `toFieldValues`, `prefillValues`, `sortFields`, `fieldStatus`,
`isoDate`; `pointsToPixels`, `pixelsToPoints`, `clientToPoints`, `scaleForWidth`,
`clampRect`, `snapToPageEdges`, `flipVertical`; `createField`, `nudgeRect`,
`defaultFieldSizes`; `encodeSignature`, `imageFileToSignature`; `loadPdf`.

Signature images are always trimmed and re-encoded to PNG, and capped at core's
`MAX_IMAGE_BYTES` (512 KB; 200 KB by default). Uploads accept PNG, JPEG and WebP up to
5 MB, have their paper background removed and never pass the original bytes through.
Field values are checked with core's `checkFieldValue`, the same rules the server uses.

### Keyboard

- Signature pad: arrow keys, Home and End move between Draw, Type and Upload. Type mode
  is the keyboard route to a signature.
- Field placer: Enter on a palette item adds the field to the page in view. On a placed
  field, arrow keys move it 1 point (Shift: 10), Alt with arrows resizes it, Delete
  removes it, Escape deselects.
- Signing view: Next field moves focus to the next required field in reading order.
  Dialogs trap focus and close on Escape.

## Theming

Set any of these on `:root` or a container. Add `data-cvs-theme="dark"` to a container
for the dark palette, or `data-cvs-theme="auto"` to follow the system.

| Variable                                                        | Use                                   |
| --------------------------------------------------------------- | ------------------------------------- |
| `--cvs-font`, `--cvs-font-size`                                 | Type                                  |
| `--cvs-radius`, `--cvs-radius-sm`                               | Corner radius                         |
| `--cvs-tap`                                                     | Minimum touch target (44px)           |
| `--cvs-bg`, `--cvs-surface`, `--cvs-surface-muted`              | Backgrounds                           |
| `--cvs-text`, `--cvs-text-muted`, `--cvs-border`                | Text and lines                        |
| `--cvs-accent`, `--cvs-accent-text`, `--cvs-focus`              | Primary actions and focus ring        |
| `--cvs-danger`, `--cvs-success`                                 | States                                |
| `--cvs-backdrop`, `--cvs-shadow`                                | Dialogs and pages                     |
| `--cvs-page-bg`, `--cvs-pad-bg`, `--cvs-pad-line`               | Page and pad surfaces                 |
| `--cvs-field-bg`, `--cvs-field-border`, `--cvs-field-filled-bg` | Fields waiting for the signer         |
| `--cvs-recipient-0` … `--cvs-recipient-5`                       | Recipient colours in the field placer |

Animations and transitions are turned off under `prefers-reduced-motion`.

## Licence

Apache-2.0 © Codevibe
