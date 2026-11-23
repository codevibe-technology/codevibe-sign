---
'codevibe-sign': minor
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-pdf': minor
---

**Breaking, before 1.0:** `codevibe-sign` is Apache-2.0 from end to end and no longer contains
or depends on the AGPL server. The `codevibe-sign/server` export, the server names on the
package root (`createSignServer`, `startSignServer`, `configFromEnv`, the stores and mailers)
and the `codevibe-sign start` command are gone. Import the server from
`@codevibe_technology/sign-server`, and run it with the Docker image or with its new command:

```sh
npx @codevibe_technology/sign-server start --memory
npx @codevibe_technology/sign-server start
```

Server: new `codevibe-sign-server` command with `start` and `start --memory`, taking the same
flags and environment variables as before.

PDF: `createDevSeal()` moves here from `codevibe-sign`, which still re-exports it, so the
server's memory mode and the `keygen` command share one Apache-2.0 implementation.
