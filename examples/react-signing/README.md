# React signing page

A Vite and React page that reads the signing token from `?token=`, asks for a one-time code
when the signer needs one, and shows the document with `SigningView` from
`@codevibe_technology/sign-react`. Submitting and declining go through `createSignerClient`.

```sh
pnpm --filter example-react-signing start
```

It expects a Sign server on `http://localhost:3000`, such as the
[embedded server example](../node-embed); set `SIGN_SERVER` to use another. The Vite dev
server proxies `/v1` to it, so the page and the API share an origin and no CORS setup is
needed. Do the same in production: serve the page from the Sign server's domain or put
both behind one reverse proxy.

The OTP session is kept in `sessionStorage`, so a reload does not ask for a new code.
