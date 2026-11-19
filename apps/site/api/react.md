---
title: '@codevibe/sign-react'
description: API reference for @codevibe/sign-react - the signature pad, signing view and field placement components, themed with CSS variables.
---

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

<!-- check:
import type { Envelope, Field, Recipient } from '@codevibe/sign-core';
declare const doc: { id: string; name: string };
declare const envelope: Envelope;
declare const pdfBytes: Uint8Array;
declare const pdfUrl: string;
declare const fields: Field[];
declare const setFields: (fields: Field[]) => void;
declare const workerSrc: string;
declare const me: Recipient;
declare const api: { submit(values: unknown): Promise<void>; decline(reason: string): Promise<void> };
declare const png: string | null;
declare const setPng: (png: string | null) => void;
-->

```tsx check
import { FieldPlacer, SigningView, SignaturePad } from '@codevibe/sign-react';

// Sender: place fields for each signer.
const placer = (
  <FieldPlacer
    documents={[{ id: doc.id, name: doc.name, file: pdfBytes }]}
    recipients={envelope.recipients}
    fields={fields}
    onChange={setFields}
    pdf={{ workerSrc }}
  />
);

// Recipient: fill and sign their own fields.
const signing = (
  <SigningView
    documents={[{ id: doc.id, file: pdfUrl }]}
    fields={envelope.fields}
    recipient={me}
    onSubmit={(values) => api.submit(values)}
    onDecline={(reason) => api.decline(reason)}
  />
);

// Just the pad. Value is PNG base64 without the data URL prefix.
const pad = <SignaturePad value={png} onChange={setPng} aspectRatio={3} />;
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

## With the server

The components never talk to a server themselves: you load the signer's page, pass it in and
send what they return. With `@codevibe/sign-server` the contract is:

- `GET /v1/sign/:token` returns `{ envelope, recipient, documents, fields, values,
otpRequired, authenticated, canAct }`. Pass `recipient`, `fields` and `values` (as
  `initialValues`) to `SigningView` as they are.
- Recipients with `email_otp` or `sms_otp` must verify a code before anything else:
  `POST /v1/sign/:token/otp` sends it and `POST /v1/sign/:token/otp/verify` with `{ code }`
  returns `{ sessionToken, expiresAt }` and sets the `cvsign_session` cookie on path
  `/v1/sign` (HTTP-only, `SameSite=Strict`, 30 minutes). Until then the document download,
  `view`, `submit` and `decline` answer `OTP_INVALID`.
- Send the session with every later request: the cookie works when the page is served from
  the same origin as the API (the server sends no CORS headers), otherwise send the
  `X-Sign-Session` header from your own proxy.
- `POST /v1/sign/:token/view` records that the signer opened the document.
- `POST /v1/sign/:token/submit` takes `{ "consent": true, "values": [...] }`. `consent` must be
  `true`, so show your consent text near the Finish button; submitting is the signer's
  agreement to it.
- `POST /v1/sign/:token/decline` takes `{ "reason" }`.
- Errors are `{ "error": { "code", "message" } }`. Throw from `onSubmit` or `onDecline` and
  `SigningView` shows the message.

A complete page, served from the same origin as the API:

```tsx check
import { useEffect, useState } from 'react';
import type { Field, FieldValue } from '@codevibe/sign-core';
import { SigningView } from '@codevibe/sign-react';

interface SignerPage {
  recipient: { id: string; name: string };
  documents: { id: string; name: string }[];
  fields: Field[];
  values: FieldValue[];
  otpRequired: boolean;
  authenticated: boolean;
}

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/v1/sign/${token}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'Something went wrong');
  return json as T;
}

export function SignPage({ token }: { token: string }) {
  const [page, setPage] = useState<SignerPage | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const load = () => call<SignerPage>(token, '').then(setPage);

  useEffect(() => void load(), [token]);
  const locked = !page || (page.otpRequired && !page.authenticated);
  useEffect(() => {
    if (!locked) void call(token, '/view', {});
  }, [locked, token]);

  if (done)
    return <p>Thank you. You will get the signed copy by email once everyone has signed.</p>;
  if (!page) return <p>Loading…</p>;
  if (locked) {
    return (
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await call(token, '/otp/verify', { code });
          await load();
        }}
      >
        <button type="button" onClick={() => void call(token, '/otp', {})}>
          Email me a code
        </button>
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
        <button type="submit">Verify</button>
      </form>
    );
  }
  return (
    <>
      <p>By selecting Finish you agree to sign this document electronically.</p>
      <SigningView
        documents={page.documents.map((d) => ({
          ...d,
          file: `/v1/sign/${token}/documents/${d.id}`,
        }))}
        fields={page.fields}
        recipient={page.recipient}
        initialValues={page.values}
        onSubmit={async (values) => {
          await call(token, '/submit', { consent: true, values });
          setDone(true);
        }}
        onDecline={async (reason) => {
          await call(token, '/decline', { reason });
          setDone(true);
        }}
      />
    </>
  );
}
```

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
