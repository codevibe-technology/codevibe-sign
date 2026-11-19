---
title: Add the React signing view
description: Show the signing screen inside your own React app and theme it with CSS variables.
---

# Add the React signing view

<ComingSoon pkg="@codevibe/sign-react" />

`@codevibe/sign-react` provides the screens recipients and senders see: a signature pad (draw,
type or upload), the signing view, and field placement for senders. The components ship
without styles and are themed with CSS variables.

```sh
pnpm add @codevibe/sign-react react react-dom
```

```tsx
import { SigningView } from '@codevibe/sign-react';

export function SignPage({ token }: { token: string }) {
  return <SigningView apiUrl="https://sign.example.com" token={token} />;
}
```

`token` is the signing token from the recipient's link. The view loads the document, asks for
the one-time code if the recipient needs one, lets them fill their fields and submits to your
Codevibe Sign server.

## Theming

Set the package's CSS variables on a parent element to match your product. The list of
variables will be documented here when the package is released.

## Where it runs

Host the signing page on your own domain and set `PUBLIC_URL` on the server to it, so the links
in invitation emails open your page.
