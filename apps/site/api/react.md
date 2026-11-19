---
title: '@codevibe/sign-react'
description: API reference for @codevibe/sign-react - the signature pad, signing view and field placement components, themed with CSS variables.
---

# @codevibe/sign-react

<ComingSoon pkg="@codevibe/sign-react" />

The screens people see: a signature pad (draw, type or upload), the signing view for
recipients and field placement for senders. Unstyled by default and themed with CSS variables.

```sh
pnpm add @codevibe/sign-react react react-dom
```

Depends on `@codevibe/sign-core`, with `react` as a peer dependency.

## Components

| Component       | Purpose                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `SigningView`   | The recipient's screen: document, one-time code, fields, sign or decline. |
| Signature pad   | Draw, type or upload a signature; produces a PNG.                         |
| Field placement | Lets the sender place fields on pages, in PDF points from the top-left.   |

```tsx
import { SigningView } from '@codevibe/sign-react';

export function SignPage({ token }: { token: string }) {
  return <SigningView apiUrl="https://sign.example.com" token={token} />;
}
```

## Props and CSS variables

The full props and the list of CSS variables will be published here from the package README
when it is merged.
