# Playground

A local demo of the whole flow in the browser: choose a PDF, place fields for two
signers, send it, then sign as each person in turn. It runs the real
`@codevibe_technology/sign-core` workflow (draft, send, view, submit or decline, hash-chained
audit log) with in-memory state. Nothing leaves the tab.

```sh
pnpm install
pnpm --filter playground dev
```

Then open the address Vite prints (usually http://localhost:5173). The app reads
the package sources directly, so there is no need to build them first.

This app is private and is not published.
