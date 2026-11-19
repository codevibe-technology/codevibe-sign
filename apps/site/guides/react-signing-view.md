---
title: Add the React signing view
description: Show the signing screen inside your own React app, connect it to the server and theme it with CSS variables.
---

# Add the React signing view

`@codevibe/sign-react` provides the screens recipients and senders see: a signature pad (draw,
type or upload), the signing view, and field placement for senders. They render PDFs with
pdf.js and are themed with CSS variables.

```sh
pnpm add @codevibe/sign-react react react-dom pdfjs-dist
```

Import the stylesheet once in your app:

```ts
import '@codevibe/sign-react/styles.css';
```

## Talking to the server

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

## pdf.js worker

`SigningView` and `FieldPlacer` load `pdfjs-dist` on first use. If your bundler does not set
up its worker, pass it in through the `pdf` prop. In Vite:

```ts
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
const pdf = { pdfjs, workerSrc };
```

## Theming

Set the CSS variables on `:root` or a parent element to match your product, for example
`--cvs-accent` for primary actions and `--cvs-font` for type. Add `data-cvs-theme="dark"` for
the dark palette or `data-cvs-theme="auto"` to follow the system. The full list is in the
[API reference](/api/react#theming).

## Where it runs

Serve the signing page from the same origin as the API, for example by routing `/v1/sign/*` to
the server in your reverse proxy, so the session cookie reaches it. Set `PUBLIC_URL` on the
server to your site and route `/sign/*` to the server too: links in invitation emails open
`/sign/<token>`, which stores the token in an HttpOnly cookie and redirects to your page at
`/sign` (or `signingPageUrl`). The page then uses `link` as its token, for example
`createSignerClient({ baseUrl, token: 'link' })` or `GET /v1/sign/link`, so no token appears
in its URL. When you embed the server in Node, you can instead pass `signingUrl` to build
links of your own shape.
